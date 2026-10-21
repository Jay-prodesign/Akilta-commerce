import { Hono, type Context } from 'hono';

import { evaluateAuthorization } from '../../../packages/authz/src';
import type { ExecutionContext, MembershipRoleReader } from '../../../packages/authz/src';
import {
  idempotencyKey,
  internalId,
  type AgencyClientAssignment,
  type ConversationId,
  type IdempotencyKey,
  type Membership,
} from '../../../packages/domain/src';
import { readUnknownBodyField, safeHttpErrorEnvelope, type SafeHttpErrorEnvelope } from './transport-contracts';
import type { MessageDraftRecord, MessageDraftStore } from './message-draft-store';

/**
 * AC-CCIA-001 — real HTTP wiring for the Control Center's `POST
 * /v1/conversations/{id}/messages/draft` operation (`CONTROL_CENTER_OPERATIONS` key
 * `message.draft`), gated by `conversation:respond` (already mapped to `CLIENT_SUPPORT_AGENT`).
 * Stages a human-authored draft reply (`message_drafts`, status `DRAFT`) — never sends anything to
 * a customer or any provider. `message.send` (the contract table's `EXTERNAL_EFFECT` sibling
 * operation) is a materially different, protected-provider-boundary concern this unit does not
 * build or approximate.
 *
 * Same deliberately-deferred boundaries as every other route this session: session/identity
 * middleware, a live Postgres connection, independent workspace-ownership verification.
 *
 * Idempotency is NOT functional end-to-end today, stated precisely rather than softened: nothing
 * in this codebase ever writes an applied outcome back into `appliedIdempotencyKeys`, so the map is
 * always empty on every real request. Two concurrent retries sharing an idempotency key the caller
 * has not yet recorded will both pass `createDraft`'s check and may both insert a draft row (see
 * message-draft-store.ts's doc comment). `DRAFTROUTE-06`/`DRAFT-03` test the pure replay branch in
 * isolation with a hand-constructed map; they do not exercise the real path by which a second HTTP
 * request's map would ever come to contain the first request's outcome, because that path does not
 * exist yet.
 */

export interface MessageDraftRouteVariables {
  executionContext: ExecutionContext;
  membershipCandidates: readonly Membership[];
  agencyAssignmentCandidates: readonly AgencyClientAssignment[];
  roleReader: MembershipRoleReader;
  messageDraftStore: MessageDraftStore;
  appliedMessageDraftIdempotencyKeys: ReadonlyMap<IdempotencyKey, MessageDraftRecord>;
}

export interface MessageDraftHttpSuccessBody {
  readonly draftId: string;
  readonly conversationId: ConversationId;
  readonly proposedText: string;
  readonly status: 'DRAFT';
  readonly createdAt: string;
  readonly replay: boolean;
}

export type MessageDraftHttpResult =
  | { readonly httpStatus: 200; readonly body: MessageDraftHttpSuccessBody }
  | { readonly httpStatus: 400; readonly body: { readonly error: 'INVALID_REQUEST'; readonly field: string; readonly requestId: string } }
  | { readonly httpStatus: 403; readonly body: SafeHttpErrorEnvelope }
  | { readonly httpStatus: 404; readonly body: { readonly code: 'NOT_FOUND'; readonly requestId: string } }
  | { readonly httpStatus: 500; readonly body: SafeHttpErrorEnvelope };

export interface MessageDraftHttpRequest {
  readonly conversationId: ConversationId;
  readonly proposedText: string;
  readonly idempotencyKey: IdempotencyKey;
  readonly executionContext: ExecutionContext;
  readonly membershipCandidates: readonly Membership[];
  readonly agencyAssignmentCandidates: readonly AgencyClientAssignment[];
  readonly roleReader: MembershipRoleReader;
  readonly store: MessageDraftStore;
  readonly appliedIdempotencyKeys: ReadonlyMap<IdempotencyKey, MessageDraftRecord>;
}

function serializeDraftRecord(record: MessageDraftRecord, replay: boolean): MessageDraftHttpSuccessBody {
  return {
    draftId: record.draftId,
    conversationId: record.conversationId,
    proposedText: record.proposedText,
    status: record.status,
    createdAt: record.createdAt,
    replay,
  };
}

export async function handleMessageDraftRequest(request: MessageDraftHttpRequest): Promise<MessageDraftHttpResult> {
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
    requiredPermission: 'conversation:respond',
    target: {
      owningOrganizationId: request.executionContext.actorOrganizationId,
      merchantWorkspaceId,
      resourceType: 'conversation',
      resourceId: request.conversationId,
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

  const outcome = await request.store.createDraft(
    request.conversationId,
    merchantWorkspaceId,
    request.proposedText,
    request.executionContext.actorUserId,
    request.idempotencyKey,
    request.appliedIdempotencyKeys,
  );

  switch (outcome.status) {
    case 'CREATED':
      return { httpStatus: 200, body: serializeDraftRecord(outcome.record, false) };
    case 'ALREADY_APPLIED':
      return { httpStatus: 200, body: serializeDraftRecord(outcome.record, true) };
    case 'NO_EXISTING_CONVERSATION':
      return { httpStatus: 404, body: { code: 'NOT_FOUND', requestId } };
    case 'STORE_ERROR':
      return {
        httpStatus: 500,
        body: safeHttpErrorEnvelope({ code: 'INTERNAL_UNEXPECTED', requestId, retryable: true, requiredAction: 'RETRY_LATER' }),
      };
  }
}

type MessageDraftRouteContext = Context<{ Variables: MessageDraftRouteVariables }>;

async function runMessageDraftRoute(c: MessageDraftRouteContext): Promise<Response> {
  const executionContext = c.get('executionContext');
  const roleReader = c.get('roleReader');
  const store = c.get('messageDraftStore');
  if (!executionContext || !roleReader || !store) {
    return new Response(JSON.stringify({ code: 'SESSION_CONTEXT_NOT_RESOLVED' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const conversationIdParam = c.req.param('id');
  if (!conversationIdParam) {
    return new Response(JSON.stringify({ code: 'NOT_FOUND', requestId: executionContext.requestId }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  const rawProposedText = readUnknownBodyField(body, 'proposedText');
  const rawIdempotencyKey = readUnknownBodyField(body, 'idempotencyKey');

  if (typeof rawProposedText !== 'string' || rawProposedText.length === 0) {
    return new Response(
      JSON.stringify({ error: 'INVALID_REQUEST', field: 'proposedText', requestId: executionContext.requestId }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    );
  }

  let parsedIdempotencyKey: IdempotencyKey;
  try {
    parsedIdempotencyKey = idempotencyKey(typeof rawIdempotencyKey === 'string' ? rawIdempotencyKey : '');
  } catch {
    return new Response(
      JSON.stringify({ error: 'INVALID_REQUEST', field: 'idempotencyKey', requestId: executionContext.requestId }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    );
  }

  const result = await handleMessageDraftRequest({
    conversationId: internalId(conversationIdParam, 'Conversation'),
    proposedText: rawProposedText,
    idempotencyKey: parsedIdempotencyKey,
    executionContext,
    membershipCandidates: c.get('membershipCandidates') ?? [],
    agencyAssignmentCandidates: c.get('agencyAssignmentCandidates') ?? [],
    roleReader,
    store,
    appliedIdempotencyKeys: c.get('appliedMessageDraftIdempotencyKeys') ?? new Map(),
  });

  return new Response(JSON.stringify(result.body), {
    status: result.httpStatus,
    headers: { 'content-type': 'application/json' },
  });
}

export function registerMessageDraftRoutes(
  app: Hono<{ Variables: MessageDraftRouteVariables }>,
): Hono<{ Variables: MessageDraftRouteVariables }> {
  app.post('/v1/conversations/:id/messages/draft', (c) => runMessageDraftRoute(c));
  return app;
}
