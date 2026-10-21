import { Hono, type Context } from 'hono';

import { evaluateAuthorization } from '../../../packages/authz/src';
import type { ExecutionContext, MembershipRoleReader } from '../../../packages/authz/src';
import { internalId, type AgencyClientAssignment, type CustomerId, type Membership } from '../../../packages/domain/src';
import { safeHttpErrorEnvelope, type SafeHttpErrorEnvelope } from './transport-contracts';
import type { CustomerContextIdentitySummary, CustomerContextStore } from './customer-context-store';

/**
 * AC-CCIA-001 — real HTTP wiring for the Control Center's `GET /v1/customers/{id}/context` read
 * operation (`CONTROL_CENTER_OPERATIONS`), gated by `customer:read` (already mapped to
 * `CLIENT_SUPPORT_AGENT`). Composes only already-built authority: `evaluateAuthorization` +
 * `createCustomerContextStore`.
 *
 * Deliberately returns identity/verification state only — never order history or raw identifier
 * strings; see `customer-context-store.ts`'s claim-ceiling note. Same deliberately-deferred
 * boundaries as every other route this session: session/identity middleware, a live Postgres
 * connection, independent workspace-ownership verification.
 */

export interface CustomerContextRouteVariables {
  executionContext: ExecutionContext;
  membershipCandidates: readonly Membership[];
  agencyAssignmentCandidates: readonly AgencyClientAssignment[];
  roleReader: MembershipRoleReader;
  customerContextStore: CustomerContextStore;
}

export interface CustomerContextHttpSuccessBody {
  readonly customerId: CustomerId;
  readonly safeDisplayName?: string;
  readonly status: string;
  readonly identities: readonly CustomerContextIdentitySummary[];
}

export type CustomerContextHttpResult =
  | { readonly httpStatus: 200; readonly body: CustomerContextHttpSuccessBody }
  | { readonly httpStatus: 403; readonly body: SafeHttpErrorEnvelope }
  | { readonly httpStatus: 404; readonly body: { readonly code: 'NOT_FOUND'; readonly requestId: string } }
  | { readonly httpStatus: 500; readonly body: SafeHttpErrorEnvelope };

export interface CustomerContextHttpRequest {
  readonly customerId: CustomerId;
  readonly executionContext: ExecutionContext;
  readonly membershipCandidates: readonly Membership[];
  readonly agencyAssignmentCandidates: readonly AgencyClientAssignment[];
  readonly roleReader: MembershipRoleReader;
  readonly store: CustomerContextStore;
}

export async function handleCustomerContextRequest(request: CustomerContextHttpRequest): Promise<CustomerContextHttpResult> {
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
    requiredPermission: 'customer:read',
    target: {
      owningOrganizationId: request.executionContext.actorOrganizationId,
      merchantWorkspaceId,
      resourceType: 'customer',
      resourceId: request.customerId,
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

  const outcome = await request.store.readContext(request.customerId, merchantWorkspaceId);
  switch (outcome.status) {
    case 'FOUND':
      return {
        httpStatus: 200,
        body: {
          customerId: outcome.context.customerId,
          ...(outcome.context.safeDisplayName !== undefined ? { safeDisplayName: outcome.context.safeDisplayName } : {}),
          status: outcome.context.status,
          identities: outcome.context.identities,
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

type CustomerContextRouteContext = Context<{ Variables: CustomerContextRouteVariables }>;

async function runCustomerContextRoute(c: CustomerContextRouteContext): Promise<Response> {
  const executionContext = c.get('executionContext');
  const roleReader = c.get('roleReader');
  const store = c.get('customerContextStore');
  if (!executionContext || !roleReader || !store) {
    return new Response(JSON.stringify({ code: 'SESSION_CONTEXT_NOT_RESOLVED' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const customerIdParam = c.req.param('id');
  if (!customerIdParam) {
    return new Response(JSON.stringify({ code: 'NOT_FOUND', requestId: executionContext.requestId }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  const result = await handleCustomerContextRequest({
    customerId: internalId(customerIdParam, 'Customer'),
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

export function registerCustomerContextRoutes(
  app: Hono<{ Variables: CustomerContextRouteVariables }>,
): Hono<{ Variables: CustomerContextRouteVariables }> {
  app.get('/v1/customers/:id/context', (c) => runCustomerContextRoute(c));
  return app;
}
