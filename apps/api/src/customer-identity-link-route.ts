import { Hono, type Context } from 'hono';

import { evaluateAuthorization } from '../../../packages/authz/src';
import type { ExecutionContext, MembershipRoleReader } from '../../../packages/authz/src';
import {
  customerIdentityLinkIdempotencyKey,
  type CustomerIdentityLinkIdempotencyKey,
  type CustomerIdentityLinkOperationKind,
  type CustomerIdentityLinkRecord,
} from '../../../packages/authz/src/customer-identity-link-transition';
import { internalId, type AgencyClientAssignment, type CustomerIdentityId, type Membership } from '../../../packages/domain/src';
import { readUnknownBodyField, safeHttpErrorEnvelope, type SafeHttpErrorEnvelope } from './transport-contracts';
import type { CustomerIdentityLinkStore } from './customer-identity-link-store';

/**
 * AC-XCID-107 — real HTTP wiring for `POST /v1/customer-identities/{id}/link` (CONTROL_CENTER_OPERATIONS
 * key `customer_identity.link`, added alongside this route — see transport-contracts.ts's comment
 * there for why), gated by `conversation:respond` (already mapped to `CLIENT_SUPPORT_AGENT`). Composes
 * already-built authority: `evaluateAuthorization` + `createCustomerIdentityLinkStore` (which itself
 * composes the pure `resolveCustomerIdentityLinkTransition`).
 *
 * A single endpoint, not three, because the pure decision function itself is already organized around
 * one `operation` field (`LINK`/`RELINK`/`UNLINK`) rather than three semantically distinct triggers —
 * unlike conversation-handoff-route.ts's HUMAN_TAKEOVER/REQUEST_RETURN_TO_AI split, which mirrors two
 * materially different real-world actions.
 *
 * Same deliberately-deferred boundaries as every other mutation route this session: session/identity
 * middleware, a durable idempotency ledger (this operation has the same always-empty-injected-map
 * limitation as every other mutation route — see conversation-handoff-route.ts's doc comment for the
 * precise disclosure, which applies identically here), a live Postgres connection, independent
 * workspace-ownership verification.
 */

export interface CustomerIdentityLinkRouteVariables {
  executionContext: ExecutionContext;
  membershipCandidates: readonly Membership[];
  agencyAssignmentCandidates: readonly AgencyClientAssignment[];
  roleReader: MembershipRoleReader;
  customerIdentityLinkStore: CustomerIdentityLinkStore;
  appliedCustomerIdentityLinkIdempotencyKeys: ReadonlyMap<CustomerIdentityLinkIdempotencyKey, CustomerIdentityLinkRecord>;
}

export interface CustomerIdentityLinkHttpSuccessBody {
  readonly customerIdentityId: CustomerIdentityId;
  readonly customerId?: string;
  readonly generation: number;
  readonly replay: boolean;
  readonly auditWriteFailed: boolean;
}

export interface CustomerIdentityLinkHttpTypedErrorBody {
  readonly code: 'NOT_FOUND' | 'LINK_CONFLICT' | 'INVALID_OPERATION';
  readonly reason?: 'STALE_EXPECTED_GENERATION' | 'RACE_LOST' | 'SCOPE_MISMATCH' | 'MISSING_TARGET_CUSTOMER' | 'ALREADY_LINKED' | 'NOT_LINKED';
  readonly requestId: string;
}

export type CustomerIdentityLinkHttpResult =
  | { readonly httpStatus: 200; readonly body: CustomerIdentityLinkHttpSuccessBody }
  | { readonly httpStatus: 400; readonly body: { readonly error: 'INVALID_REQUEST'; readonly field: string; readonly requestId: string } }
  | { readonly httpStatus: 403; readonly body: SafeHttpErrorEnvelope }
  | { readonly httpStatus: 404; readonly body: CustomerIdentityLinkHttpTypedErrorBody }
  | { readonly httpStatus: 409; readonly body: CustomerIdentityLinkHttpTypedErrorBody }
  | { readonly httpStatus: 500; readonly body: SafeHttpErrorEnvelope };

export interface CustomerIdentityLinkHttpRequest {
  readonly customerIdentityId: CustomerIdentityId;
  readonly operation: CustomerIdentityLinkOperationKind;
  readonly targetCustomerId?: string;
  readonly expectedGeneration: number;
  readonly idempotencyKey: CustomerIdentityLinkIdempotencyKey;
  readonly actorRef: string;
  readonly executionContext: ExecutionContext;
  readonly membershipCandidates: readonly Membership[];
  readonly agencyAssignmentCandidates: readonly AgencyClientAssignment[];
  readonly roleReader: MembershipRoleReader;
  readonly store: CustomerIdentityLinkStore;
  readonly appliedIdempotencyKeys: ReadonlyMap<CustomerIdentityLinkIdempotencyKey, CustomerIdentityLinkRecord>;
}

export async function handleCustomerIdentityLinkRequest(
  request: CustomerIdentityLinkHttpRequest,
): Promise<CustomerIdentityLinkHttpResult> {
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
      resourceType: 'customer_identity',
      resourceId: request.customerIdentityId,
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

  const outcome = await request.store.applyTransition(
    {
      customerIdentityId: request.customerIdentityId,
      merchantWorkspaceId,
      operation: request.operation,
      ...(request.targetCustomerId !== undefined
        ? { targetCustomerId: internalId(request.targetCustomerId, 'Customer') }
        : {}),
      expectedGeneration: request.expectedGeneration,
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
          customerIdentityId: request.customerIdentityId,
          ...(outcome.resultingRecord.customerId !== undefined ? { customerId: outcome.resultingRecord.customerId } : {}),
          generation: outcome.resultingRecord.generation,
          replay: false,
          auditWriteFailed: false,
        },
      };
    case 'ALREADY_APPLIED':
      return {
        httpStatus: 200,
        body: {
          customerIdentityId: request.customerIdentityId,
          ...(outcome.resultingRecord.customerId !== undefined ? { customerId: outcome.resultingRecord.customerId } : {}),
          generation: outcome.resultingRecord.generation,
          replay: true,
          auditWriteFailed: false,
        },
      };
    case 'AUDIT_WRITE_FAILED':
      return {
        httpStatus: 200,
        body: {
          customerIdentityId: request.customerIdentityId,
          ...(outcome.resultingRecord.customerId !== undefined ? { customerId: outcome.resultingRecord.customerId } : {}),
          generation: outcome.resultingRecord.generation,
          replay: false,
          auditWriteFailed: true,
        },
      };
    case 'CONFLICT':
      return { httpStatus: 409, body: { code: 'LINK_CONFLICT', reason: outcome.reason, requestId } };
    case 'RACE_LOST':
      return { httpStatus: 409, body: { code: 'LINK_CONFLICT', reason: 'RACE_LOST', requestId } };
    case 'NO_EXISTING_IDENTITY':
      return { httpStatus: 404, body: { code: 'NOT_FOUND', requestId } };
    case 'DENIED':
      if (outcome.reason === 'SCOPE_MISMATCH') {
        return { httpStatus: 404, body: { code: 'NOT_FOUND', requestId } };
      }
      return { httpStatus: 409, body: { code: 'INVALID_OPERATION', reason: outcome.reason, requestId } };
    case 'STORE_ERROR':
      return {
        httpStatus: 500,
        body: safeHttpErrorEnvelope({ code: 'INTERNAL_UNEXPECTED', requestId, retryable: true, requiredAction: 'RETRY_LATER' }),
      };
  }
}

type CustomerIdentityLinkRouteContext = Context<{ Variables: CustomerIdentityLinkRouteVariables }>;

const VALID_OPERATIONS: readonly CustomerIdentityLinkOperationKind[] = ['LINK', 'RELINK', 'UNLINK'];

function isValidOperation(value: unknown): value is CustomerIdentityLinkOperationKind {
  return typeof value === 'string' && (VALID_OPERATIONS as readonly string[]).includes(value);
}

async function runCustomerIdentityLinkRoute(c: CustomerIdentityLinkRouteContext): Promise<Response> {
  const executionContext = c.get('executionContext');
  const roleReader = c.get('roleReader');
  const store = c.get('customerIdentityLinkStore');
  if (!executionContext || !roleReader || !store) {
    return new Response(JSON.stringify({ code: 'SESSION_CONTEXT_NOT_RESOLVED' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const customerIdentityIdParam = c.req.param('id');
  if (!customerIdentityIdParam) {
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
  const rawOperation = readUnknownBodyField(body, 'operation');
  const rawTargetCustomerId = readUnknownBodyField(body, 'targetCustomerId');
  const rawExpectedGeneration = readUnknownBodyField(body, 'expectedGeneration');
  const rawIdempotencyKey = readUnknownBodyField(body, 'idempotencyKey');

  if (!isValidOperation(rawOperation)) {
    return new Response(
      JSON.stringify({ error: 'INVALID_REQUEST', field: 'operation', requestId: executionContext.requestId }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    );
  }

  if (rawTargetCustomerId !== undefined && (typeof rawTargetCustomerId !== 'string' || rawTargetCustomerId.length === 0)) {
    return new Response(
      JSON.stringify({ error: 'INVALID_REQUEST', field: 'targetCustomerId', requestId: executionContext.requestId }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    );
  }

  const expectedGeneration =
    typeof rawExpectedGeneration === 'number' && Number.isInteger(rawExpectedGeneration) && rawExpectedGeneration >= 0
      ? rawExpectedGeneration
      : undefined;
  if (expectedGeneration === undefined) {
    return new Response(
      JSON.stringify({ error: 'INVALID_REQUEST', field: 'expectedGeneration', requestId: executionContext.requestId }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    );
  }

  const rawIdempotencyKeyInput = typeof rawIdempotencyKey === 'string' ? rawIdempotencyKey.trim() : '';
  if (rawIdempotencyKeyInput.length === 0) {
    return new Response(
      JSON.stringify({ error: 'INVALID_REQUEST', field: 'idempotencyKey', requestId: executionContext.requestId }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    );
  }
  // Scoped to (workspace, identity, operation, caller key) — a per-D-090-#2 collision-safety fix:
  // the caller-supplied key alone is not tenant-bound, so two different workspaces/identities/
  // operations reusing the same opaque string must never be able to collide once a durable
  // idempotency ledger is wired behind the currently-always-empty injected map (see this route's
  // own doc comment for that still-deferred boundary). JSON encoding, not delimiter concatenation,
  // for the same collision-safety reason as permission-authority.ts's deriveAuthorityVersion.
  const idempotencyKey: CustomerIdentityLinkIdempotencyKey = customerIdentityLinkIdempotencyKey(
    JSON.stringify([executionContext.activeMerchantWorkspaceId, customerIdentityIdParam, rawOperation, rawIdempotencyKeyInput]),
  );

  const result = await handleCustomerIdentityLinkRequest({
    customerIdentityId: internalId(customerIdentityIdParam, 'CustomerIdentity'),
    operation: rawOperation,
    ...(typeof rawTargetCustomerId === 'string' ? { targetCustomerId: rawTargetCustomerId } : {}),
    expectedGeneration,
    idempotencyKey,
    actorRef: String(executionContext.actorUserId),
    executionContext,
    membershipCandidates: c.get('membershipCandidates') ?? [],
    agencyAssignmentCandidates: c.get('agencyAssignmentCandidates') ?? [],
    roleReader,
    store,
    appliedIdempotencyKeys: c.get('appliedCustomerIdentityLinkIdempotencyKeys') ?? new Map(),
  });

  return new Response(JSON.stringify(result.body), {
    status: result.httpStatus,
    headers: { 'content-type': 'application/json' },
  });
}

export function registerCustomerIdentityLinkRoutes(
  app: Hono<{ Variables: CustomerIdentityLinkRouteVariables }>,
): Hono<{ Variables: CustomerIdentityLinkRouteVariables }> {
  app.post('/v1/customer-identities/:id/link', (c) => runCustomerIdentityLinkRoute(c));
  return app;
}
