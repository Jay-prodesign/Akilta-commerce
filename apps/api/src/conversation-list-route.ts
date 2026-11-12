import { Hono, type Context } from 'hono';

import { evaluateAuthorization } from '../../../packages/authz/src';
import type { ExecutionContext, MembershipRoleReader } from '../../../packages/authz/src';
import type { AgencyClientAssignment, Membership } from '../../../packages/domain/src';
import { safeHttpErrorEnvelope, type SafeHttpErrorEnvelope } from './transport-contracts';
import type { ConversationListRow, ConversationListStore } from './conversation-list-store';

/**
 * AC-CCIA-001 — real HTTP wiring for the Control Center's `GET /v1/conversations` list operation
 * (`CONTROL_CENTER_OPERATIONS` key `conversation.list`), gated by `conversation:read` (already
 * mapped to `CLIENT_SUPPORT_AGENT`). Composes only already-built authority: `evaluateAuthorization`
 * + `createConversationListStore`. Workspace-scoped, not single-resource-scoped — same
 * `resourceType`-only target shape as `usage-summary-route.ts`, since a list has no one
 * `resourceId` to bind the authorization check to.
 *
 * Bounded, most-recent-first, no cursor: see `conversation-list-store.ts`'s doc comment for why a
 * cursor-pagination wire format is not invented in this unit.
 *
 * Same deliberately-deferred boundaries as every other route this session: session/identity
 * middleware, a live Postgres connection, independent workspace-ownership verification.
 */

export interface ConversationListRouteVariables {
  executionContext: ExecutionContext;
  membershipCandidates: readonly Membership[];
  agencyAssignmentCandidates: readonly AgencyClientAssignment[];
  roleReader: MembershipRoleReader;
  conversationListStore: ConversationListStore;
}

export interface ConversationListHttpRow {
  readonly conversationId: string;
  readonly channel: string;
  readonly customerIdentityId?: string;
  readonly ownershipState: string;
  readonly ownershipEpoch: number;
  readonly assignedUserId?: string;
  readonly status: string;
  readonly lastMessageAt?: string;
  readonly lastCustomerMessageAt?: string;
  readonly lastOutboundAt?: string;
}

export interface ConversationListHttpSuccessBody {
  readonly conversations: readonly ConversationListHttpRow[];
}

function serializeConversationListRow(row: ConversationListRow): ConversationListHttpRow {
  return {
    conversationId: row.conversationId,
    channel: row.channel,
    ...(row.customerIdentityId !== undefined ? { customerIdentityId: row.customerIdentityId } : {}),
    ownershipState: row.ownershipState,
    ownershipEpoch: row.ownershipEpoch,
    ...(row.assignedUserId !== undefined ? { assignedUserId: row.assignedUserId } : {}),
    status: row.status,
    ...(row.lastMessageAt !== undefined ? { lastMessageAt: row.lastMessageAt } : {}),
    ...(row.lastCustomerMessageAt !== undefined ? { lastCustomerMessageAt: row.lastCustomerMessageAt } : {}),
    ...(row.lastOutboundAt !== undefined ? { lastOutboundAt: row.lastOutboundAt } : {}),
  };
}

export type ConversationListHttpResult =
  | { readonly httpStatus: 200; readonly body: ConversationListHttpSuccessBody }
  | { readonly httpStatus: 403; readonly body: SafeHttpErrorEnvelope }
  | { readonly httpStatus: 500; readonly body: SafeHttpErrorEnvelope };

export interface ConversationListHttpRequest {
  readonly executionContext: ExecutionContext;
  readonly membershipCandidates: readonly Membership[];
  readonly agencyAssignmentCandidates: readonly AgencyClientAssignment[];
  readonly roleReader: MembershipRoleReader;
  readonly store: ConversationListStore;
}

export async function handleConversationListRequest(request: ConversationListHttpRequest): Promise<ConversationListHttpResult> {
  const requestId = request.executionContext.requestId;

  if (request.executionContext.activeMerchantWorkspaceId === null) {
    return {
      httpStatus: 403,
      body: safeHttpErrorEnvelope({ code: 'AUTH_TENANT_MISMATCH', requestId, retryable: false, requiredAction: 'NONE' }),
    };
  }
  const merchantWorkspaceId = request.executionContext.activeMerchantWorkspaceId;

  const authorization = await evaluateAuthorization({
    executionContext: request.executionContext,
    requiredPermission: 'conversation:read',
    target: {
      owningOrganizationId: request.executionContext.actorOrganizationId,
      merchantWorkspaceId,
      resourceType: 'conversation_list',
    },
    module: 'conversation',
    membershipCandidates: request.membershipCandidates,
    agencyAssignmentCandidates: request.agencyAssignmentCandidates,
    roleReader: request.roleReader,
  });

  if (authorization.decision === 'DENY') {
    return {
      httpStatus: 403,
      body: safeHttpErrorEnvelope({ code: authorization.code, requestId, retryable: false, requiredAction: 'NONE' }),
    };
  }

  const outcome = await request.store.readRecentConversations(merchantWorkspaceId);
  if (outcome.status === 'STORE_ERROR') {
    return {
      httpStatus: 500,
      body: safeHttpErrorEnvelope({ code: 'INTERNAL_UNEXPECTED', requestId, retryable: true, requiredAction: 'RETRY_LATER' }),
    };
  }

  return {
    httpStatus: 200,
    body: { conversations: outcome.conversations.map(serializeConversationListRow) },
  };
}

type ConversationListRouteContext = Context<{ Variables: ConversationListRouteVariables }>;

async function runConversationListRoute(c: ConversationListRouteContext): Promise<Response> {
  const executionContext = c.get('executionContext');
  const roleReader = c.get('roleReader');
  const store = c.get('conversationListStore');
  if (!executionContext || !roleReader || !store) {
    return new Response(JSON.stringify({ code: 'SESSION_CONTEXT_NOT_RESOLVED' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const result = await handleConversationListRequest({
    executionContext,
    membershipCandidates: c.get('membershipCandidates') ?? [],
    agencyAssignmentCandidates: c.get('agencyAssignmentCandidates') ?? [],
    roleReader,
    store,
  });

  return new Response(JSON.stringify(result.body), {
    status: result.httpStatus,
    headers: { 'content-type': 'application/json' },
  });
}

export function registerConversationListRoutes(
  app: Hono<{ Variables: ConversationListRouteVariables }>,
): Hono<{ Variables: ConversationListRouteVariables }> {
  app.get('/v1/conversations', (c) => runConversationListRoute(c));
  return app;
}
