import { Hono, type Context } from 'hono';

import { evaluateAuthorization } from '../../../packages/authz/src';
import type { ExecutionContext, MembershipRoleReader } from '../../../packages/authz/src';
import {
  conversationOwnershipIdempotencyKey,
  type ConversationOwnershipIdempotencyKey,
  type ConversationOwnershipRecord,
  type ConversationOwnershipTrigger,
} from '../../../packages/authz/src/conversation-ownership-transition';
import { internalId, type AgencyClientAssignment, type ConversationId, type Membership } from '../../../packages/domain/src';
import { readUnknownBodyField, safeHttpErrorEnvelope, type SafeHttpErrorEnvelope } from './transport-contracts';
import type { ConversationOwnershipStore } from './conversation-ownership-store';

/**
 * SC-05 (Conversation Core / AC-HANDOFF-106) — first real HTTP wiring of the Golden Merchant
 * Journey's "Inbox and conversation continuity" / "human takeover" capability. Follows the
 * 2026-10-16 FULL CR-V1 PRODUCT COMPLETION EXECUTION DIRECTIVE (canonical Doc 25): this is the
 * highest-priority dependency-ready merchant outcome available without inventing provider
 * credentials or a new session/architecture layer — it composes entirely already-built, already-
 * tested authority (`evaluateAuthorization`, `resolveConversationOwnershipTransition`,
 * `createConversationOwnershipStore`) into an actual callable `/v1/conversations/{id}/handoff` and
 * `/v1/conversations/{id}/return-to-ai` HTTP surface, matching the exact two POST operations the
 * `CONTROL_CENTER_OPERATIONS` contract table (transport-contracts.ts) already specified.
 *
 * What is deliberately NOT built here, stated explicitly rather than silently assumed:
 *  - Session/identity middleware that turns a real caller's cookie/token into an `ExecutionContext`.
 *    That is a separate, not-yet-selected unit (same boundary `auth-identity.ts`'s
 *    `resolveAuthenticatedPrincipal` already draws — a verified identity proof still is not an
 *    `ExecutionContext`). This route reads `c.get('executionContext')` and the other per-request
 *    authority dependencies from Hono context variables a future middleware is responsible for
 *    setting; if nothing sets them, the route fails closed (SESSION_CONTEXT_NOT_RESOLVED), never
 *    silently bypasses authorization.
 *  - A durable idempotency-key ledger read. `appliedIdempotencyKeys` is accepted as an injected
 *    dependency, same precedent as every store adapter this session (P0-004: "real event
 *    persistence/atomic idempotency storage/runtime remain later concerns").
 *  - A live Postgres connection. `store` wraps a `ConversationOwnershipQueryExecutor`; which concrete
 *    executor backs it in a given environment (real `pg` pool vs. a test double) is a deploy-time/
 *    test-time binding, not something this file decides.
 *  - An independent workspace-ownership lookup. `evaluateAuthorization`'s target is built from
 *    `executionContext.activeMerchantWorkspaceId` / `.actorOrganizationId` directly (no
 *    `MerchantWorkspace` read-by-id adapter exists anywhere yet to cross-check them), so its
 *    ACTIVE_WORKSPACE_MISMATCH/STANDALONE_ORGANIZATION_MISMATCH tenant checks are necessarily
 *    tautological here — they verify the session's own internal consistency, not that the session
 *    actually owns the resolved workspace. Real tenant isolation for this route rests entirely on
 *    the not-yet-built session middleware supplying a correct, self-consistent `ExecutionContext`
 *    (the same trust boundary `conversation-ownership-store.ts`'s own `merchant_workspace_id`-scoped
 *    SQL already depends on) plus the `conversation:assign` permission grant actually being scoped
 *    correctly — it is not independently re-verified by this route.
 *
 * Target resolution is server-side by construction: `merchantWorkspaceId` is read only from the
 * caller's own `executionContext.activeMerchantWorkspaceId`, never from the request path/body —
 * identical discipline to every other unit this session ("provider/model/client payloads may name a
 * resource but do not establish this binding").
 */

export interface ConversationOwnershipHttpSuccessBody {
  readonly conversationId: ConversationId;
  readonly ownershipState: ConversationOwnershipRecord['state'];
  readonly epoch: number;
  readonly replay: boolean;
  readonly auditWriteFailed: boolean;
}

export interface ConversationOwnershipHttpTypedErrorBody {
  readonly code: 'NOT_FOUND' | 'OWNERSHIP_CONFLICT' | 'INVALID_TRANSITION';
  readonly reason?: 'STALE_EXPECTED_EPOCH' | 'RACE_LOST' | 'TERMINAL_STATE' | 'TRIGGER_NOT_ALLOWED_FROM_STATE';
  readonly requestId: string;
}

export type ConversationOwnershipHttpResult =
  | { readonly httpStatus: 200; readonly body: ConversationOwnershipHttpSuccessBody }
  | { readonly httpStatus: 403; readonly body: SafeHttpErrorEnvelope }
  | { readonly httpStatus: 404; readonly body: ConversationOwnershipHttpTypedErrorBody }
  | { readonly httpStatus: 409; readonly body: ConversationOwnershipHttpTypedErrorBody }
  | { readonly httpStatus: 500; readonly body: SafeHttpErrorEnvelope };

export interface ConversationOwnershipHttpRequest {
  readonly trigger: ConversationOwnershipTrigger;
  readonly conversationId: ConversationId;
  readonly expectedEpoch: number;
  readonly idempotencyKey: ConversationOwnershipIdempotencyKey;
  readonly actorRef: string;
  readonly executionContext: ExecutionContext;
  readonly membershipCandidates: readonly Membership[];
  readonly agencyAssignmentCandidates: readonly AgencyClientAssignment[];
  readonly roleReader: MembershipRoleReader;
  readonly store: ConversationOwnershipStore;
  readonly appliedIdempotencyKeys: ReadonlyMap<ConversationOwnershipIdempotencyKey, ConversationOwnershipRecord>;
}

export async function handleConversationOwnershipTransitionRequest(
  request: ConversationOwnershipHttpRequest,
): Promise<ConversationOwnershipHttpResult> {
  const requestId = request.executionContext.requestId;

  if (request.executionContext.activeMerchantWorkspaceId === null) {
    return {
      httpStatus: 403,
      body: safeHttpErrorEnvelope({
        code: 'AUTH_TENANT_MISMATCH',
        requestId,
        retryable: false,
        requiredAction: 'NONE',
      }),
    };
  }
  const merchantWorkspaceId = request.executionContext.activeMerchantWorkspaceId;

  const authorization = await evaluateAuthorization({
    executionContext: request.executionContext,
    requiredPermission: 'conversation:assign',
    target: {
      owningOrganizationId: request.executionContext.actorOrganizationId,
      merchantWorkspaceId,
      resourceType: 'conversation',
      resourceId: request.conversationId,
    },
    membershipCandidates: request.membershipCandidates,
    agencyAssignmentCandidates: request.agencyAssignmentCandidates,
    roleReader: request.roleReader,
  });

  if (authorization.decision === 'DENY') {
    return {
      httpStatus: 403,
      body: safeHttpErrorEnvelope({
        code: authorization.code,
        requestId,
        retryable: false,
        requiredAction: 'NONE',
      }),
    };
  }

  const outcome = await request.store.applyTransition(
    {
      conversationId: request.conversationId,
      merchantWorkspaceId,
      trigger: request.trigger,
      expectedEpoch: request.expectedEpoch,
      idempotencyKey: request.idempotencyKey,
    },
    request.actorRef,
    request.appliedIdempotencyKeys,
  );

  switch (outcome.status) {
    case 'APPLIED':
      return {
        httpStatus: 200,
        body: {
          conversationId: request.conversationId,
          ownershipState: outcome.resultingRecord.state,
          epoch: outcome.resultingRecord.epoch,
          replay: false,
          auditWriteFailed: false,
        },
      };
    case 'ALREADY_APPLIED':
      return {
        httpStatus: 200,
        body: {
          conversationId: request.conversationId,
          ownershipState: outcome.resultingRecord.state,
          epoch: outcome.resultingRecord.epoch,
          replay: true,
          auditWriteFailed: false,
        },
      };
    case 'AUDIT_WRITE_FAILED':
      // The authority-bearing CAS update already succeeded; reporting this as a failure would be
      // false. It is reported as a real success carrying an explicit audit-trail warning instead.
      return {
        httpStatus: 200,
        body: {
          conversationId: request.conversationId,
          ownershipState: outcome.resultingRecord.state,
          epoch: outcome.resultingRecord.epoch,
          replay: false,
          auditWriteFailed: true,
        },
      };
    case 'CONFLICT':
      return { httpStatus: 409, body: { code: 'OWNERSHIP_CONFLICT', reason: outcome.reason, requestId } };
    case 'RACE_LOST':
      return { httpStatus: 409, body: { code: 'OWNERSHIP_CONFLICT', reason: 'RACE_LOST', requestId } };
    case 'NO_EXISTING_CONVERSATION':
      return { httpStatus: 404, body: { code: 'NOT_FOUND', requestId } };
    case 'DENIED':
      if (outcome.reason === 'SCOPE_MISMATCH') {
        return { httpStatus: 404, body: { code: 'NOT_FOUND', requestId } };
      }
      return { httpStatus: 409, body: { code: 'INVALID_TRANSITION', reason: outcome.reason, requestId } };
    case 'STORE_ERROR':
      return {
        httpStatus: 500,
        body: safeHttpErrorEnvelope({
          code: 'INTERNAL_UNEXPECTED',
          requestId,
          retryable: true,
          requiredAction: 'RETRY_LATER',
        }),
      };
  }
}

/**
 * Per-request authority dependencies a future session/tenancy middleware is responsible for
 * populating via `c.set(...)`. Deliberately a Hono context-variable contract, not a constructor
 * parameter, so the route itself never has to know how (or whether) that middleware is wired in a
 * given deployment — it only ever reads the finished contract and fails closed if it is absent.
 */
export interface ConversationOwnershipRouteVariables {
  executionContext: ExecutionContext;
  membershipCandidates: readonly Membership[];
  agencyAssignmentCandidates: readonly AgencyClientAssignment[];
  roleReader: MembershipRoleReader;
  conversationOwnershipStore: ConversationOwnershipStore;
  appliedConversationOwnershipIdempotencyKeys: ReadonlyMap<
    ConversationOwnershipIdempotencyKey,
    ConversationOwnershipRecord
  >;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

type ConversationOwnershipRouteContext = Context<{ Variables: ConversationOwnershipRouteVariables }>;

async function runRoute(c: ConversationOwnershipRouteContext, trigger: ConversationOwnershipTrigger): Promise<Response> {
  const executionContext = c.get('executionContext');
  const roleReader = c.get('roleReader');
  const store = c.get('conversationOwnershipStore');
  if (!executionContext || !roleReader || !store) {
    // Nothing has populated the per-request authority contract (no session middleware wired yet in
    // this deployment) — fail closed rather than fabricate or skip authorization.
    return jsonResponse({ code: 'SESSION_CONTEXT_NOT_RESOLVED' }, 500);
  }

  const conversationIdParam = c.req.param('id');
  if (!conversationIdParam) {
    return jsonResponse({ code: 'NOT_FOUND', requestId: executionContext.requestId }, 404);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  const rawExpectedEpoch = readUnknownBodyField(body, 'expectedEpoch');
  const rawIdempotencyKey = readUnknownBodyField(body, 'idempotencyKey');

  const expectedEpoch =
    typeof rawExpectedEpoch === 'number' && Number.isInteger(rawExpectedEpoch) && rawExpectedEpoch >= 0
      ? rawExpectedEpoch
      : undefined;
  if (expectedEpoch === undefined) {
    return jsonResponse(
      { error: 'INVALID_REQUEST', field: 'expectedEpoch', requestId: executionContext.requestId },
      400,
    );
  }

  let idempotencyKey: ConversationOwnershipIdempotencyKey;
  try {
    idempotencyKey = conversationOwnershipIdempotencyKey(typeof rawIdempotencyKey === 'string' ? rawIdempotencyKey : '');
  } catch {
    return jsonResponse(
      { error: 'INVALID_REQUEST', field: 'idempotencyKey', requestId: executionContext.requestId },
      400,
    );
  }

  const result = await handleConversationOwnershipTransitionRequest({
    trigger,
    conversationId: internalId(conversationIdParam, 'Conversation'),
    expectedEpoch,
    idempotencyKey,
    actorRef: String(executionContext.actorUserId),
    executionContext,
    membershipCandidates: c.get('membershipCandidates') ?? [],
    agencyAssignmentCandidates: c.get('agencyAssignmentCandidates') ?? [],
    roleReader,
    store,
    appliedIdempotencyKeys: c.get('appliedConversationOwnershipIdempotencyKeys') ?? new Map(),
  });

  return jsonResponse(result.body, result.httpStatus);
}

export interface ConversationOwnershipReadHttpSuccessBody {
  readonly conversationId: ConversationId;
  readonly ownershipState: ConversationOwnershipRecord['state'];
  readonly epoch: number;
}

export type ConversationOwnershipReadHttpResult =
  | { readonly httpStatus: 200; readonly body: ConversationOwnershipReadHttpSuccessBody }
  | { readonly httpStatus: 403; readonly body: SafeHttpErrorEnvelope }
  | { readonly httpStatus: 404; readonly body: ConversationOwnershipHttpTypedErrorBody }
  | { readonly httpStatus: 500; readonly body: SafeHttpErrorEnvelope };

export interface ConversationOwnershipReadHttpRequest {
  readonly conversationId: ConversationId;
  readonly executionContext: ExecutionContext;
  readonly membershipCandidates: readonly Membership[];
  readonly agencyAssignmentCandidates: readonly AgencyClientAssignment[];
  readonly roleReader: MembershipRoleReader;
  readonly store: ConversationOwnershipStore;
}

/**
 * Read-only counterpart to `handleConversationOwnershipTransitionRequest`: the `conversation:read`
 * gate is intentionally weaker than `conversation:assign` (a caller may be allowed to see current
 * state without being allowed to change who owns it). Lets a client discover the `epoch` it must
 * supply as the CAS precondition on a subsequent handoff/return-to-ai call.
 */
export async function handleConversationOwnershipReadRequest(
  request: ConversationOwnershipReadHttpRequest,
): Promise<ConversationOwnershipReadHttpResult> {
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
      resourceType: 'conversation',
      resourceId: request.conversationId,
    },
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

  const outcome = await request.store.getCurrent(request.conversationId, merchantWorkspaceId);
  switch (outcome.status) {
    case 'FOUND':
      return {
        httpStatus: 200,
        body: {
          conversationId: request.conversationId,
          ownershipState: outcome.record.state,
          epoch: outcome.record.epoch,
        },
      };
    case 'NOT_FOUND':
      return { httpStatus: 404, body: { code: 'NOT_FOUND', requestId } };
    case 'STORE_ERROR':
      return {
        httpStatus: 500,
        body: safeHttpErrorEnvelope({ code: 'INTERNAL_UNEXPECTED', requestId, retryable: true, requiredAction: 'RETRY_LATER' }),
      };
  }
}

async function runReadRoute(c: ConversationOwnershipRouteContext): Promise<Response> {
  const executionContext = c.get('executionContext');
  const roleReader = c.get('roleReader');
  const store = c.get('conversationOwnershipStore');
  if (!executionContext || !roleReader || !store) {
    return jsonResponse({ code: 'SESSION_CONTEXT_NOT_RESOLVED' }, 500);
  }

  const conversationIdParam = c.req.param('id');
  if (!conversationIdParam) {
    return jsonResponse({ code: 'NOT_FOUND', requestId: executionContext.requestId }, 404);
  }

  const result = await handleConversationOwnershipReadRequest({
    conversationId: internalId(conversationIdParam, 'Conversation'),
    executionContext,
    membershipCandidates: c.get('membershipCandidates') ?? [],
    agencyAssignmentCandidates: c.get('agencyAssignmentCandidates') ?? [],
    roleReader,
    store,
  });

  return jsonResponse(result.body, result.httpStatus);
}

/**
 * Registers the real `/v1/conversations/{id}` read route plus the `/v1/conversations/{id}/handoff`
 * and `/v1/conversations/{id}/return-to-ai` mutation routes on any Hono app — the production
 * `worker.ts` app and an isolated test app alike, so both exercise the identical real dispatch/
 * parse/response path (no test-only duplicate route logic).
 */
export function registerConversationOwnershipRoutes(
  app: Hono<{ Variables: ConversationOwnershipRouteVariables }>,
): Hono<{ Variables: ConversationOwnershipRouteVariables }> {
  app.get('/v1/conversations/:id', (c) => runReadRoute(c));
  app.post('/v1/conversations/:id/handoff', (c) => runRoute(c, 'HUMAN_TAKEOVER'));
  app.post('/v1/conversations/:id/return-to-ai', (c) => runRoute(c, 'REQUEST_RETURN_TO_AI'));
  return app;
}
