import { Hono, type Context } from 'hono';

import { evaluateAuthorization } from '../../../packages/authz/src';
import type { ExecutionContext, MembershipRoleReader } from '../../../packages/authz/src';
import {
  internalId,
  type AgencyClientAssignment,
  type CustomerId,
  type MerchantWorkspaceId,
  type Membership,
} from '../../../packages/domain/src';
import { safeHttpErrorEnvelope, serializeMoneyForHttp, type HttpSerializedMoney, type SafeHttpErrorEnvelope } from './transport-contracts';
import type { CustomerContextIdentitySummary, CustomerContextStore } from './customer-context-store';
import type { CustomerOrderSummary, CustomerOrdersStore } from './customer-orders-store';

/**
 * AC-CCIA-001 — real HTTP wiring for the Control Center's `GET /v1/customers/{id}/context` read
 * operation (`CONTROL_CENTER_OPERATIONS`), gated by `customer:read` (already mapped to
 * `CLIENT_SUPPORT_AGENT`). Composes only already-built authority: `evaluateAuthorization` +
 * `createCustomerContextStore`.
 *
 * Order history is a second, independently-gated disclosure: only included when the caller's own
 * `commerce.order:read` grant also passes (checked separately from `customer:read` — a role could
 * hold one without the other even though `CLIENT_SUPPORT_AGENT` currently holds both). A denied
 * order check never fails the whole request; `orders` is simply absent from the response, same
 * progressive-disclosure shape as every optional field in this codebase. This is deliberately NOT
 * `authorizeCustomerOrderAccess` (packages/domain/src/customer-identity.ts) — that function verifies
 * a *customer's own* channel identity before disclosing their order back to them on a customer-
 * facing channel; this is an internal staff dashboard read already gated by the caller's own
 * `commerce.order:read` membership grant, a structurally different authorization question.
 *
 * Identity/verification fields still never include raw identifier strings — see
 * `customer-context-store.ts`'s claim-ceiling note. Same deliberately-deferred boundaries as every
 * other route this session: session/identity middleware, a live Postgres connection, independent
 * workspace-ownership verification.
 */

export interface CustomerContextRouteVariables {
  executionContext: ExecutionContext;
  membershipCandidates: readonly Membership[];
  agencyAssignmentCandidates: readonly AgencyClientAssignment[];
  roleReader: MembershipRoleReader;
  customerContextStore: CustomerContextStore;
  customerOrdersStore: CustomerOrdersStore;
}

export interface CustomerContextHttpOrderSummary {
  readonly orderId: string;
  readonly displayOrderRef: string;
  readonly orderStatus: string;
  readonly paymentStatus: string;
  readonly totalAmount?: HttpSerializedMoney;
  readonly completenessScope: 'FULL_HISTORY' | 'BOUNDED_HISTORY' | 'UNKNOWN';
  readonly providerCreatedAt: string;
}

export interface CustomerContextHttpSuccessBody {
  readonly customerId: CustomerId;
  readonly safeDisplayName?: string;
  readonly status: string;
  readonly identities: readonly CustomerContextIdentitySummary[];
  /** Absent (not an empty array) when the caller's own commerce.order:read grant is not held. */
  readonly orders?: readonly CustomerContextHttpOrderSummary[];
}

function serializeOrder(order: {
  readonly orderId: string;
  readonly displayOrderRef: string;
  readonly orderStatus: string;
  readonly paymentStatus: string;
  readonly totalAmount?: { readonly amountMinor: bigint; readonly currency: string };
  readonly completenessScope: 'FULL_HISTORY' | 'BOUNDED_HISTORY' | 'UNKNOWN';
  readonly providerCreatedAt: string;
}): CustomerContextHttpOrderSummary {
  return {
    orderId: order.orderId,
    displayOrderRef: order.displayOrderRef,
    orderStatus: order.orderStatus,
    paymentStatus: order.paymentStatus,
    ...(order.totalAmount ? { totalAmount: serializeMoneyForHttp(order.totalAmount) } : {}),
    completenessScope: order.completenessScope,
    providerCreatedAt: order.providerCreatedAt,
  };
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
  readonly ordersStore: CustomerOrdersStore;
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
    module: 'customer',
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

  // Neither read depends on the other's outcome (both are scoped by the same customerId/
  // merchantWorkspaceId already established above), so they run concurrently; the order-history
  // result is simply discarded below for a NOT_FOUND/STORE_ERROR context outcome.
  const [outcome, orders] = await Promise.all([
    request.store.readContext(request.customerId, merchantWorkspaceId),
    readOrdersIfAuthorized(request, merchantWorkspaceId),
  ]);
  switch (outcome.status) {
    case 'FOUND': {
      if (orders.status === 'STORE_ERROR') {
        return {
          httpStatus: 500,
          body: safeHttpErrorEnvelope({ code: 'INTERNAL_UNEXPECTED', requestId, retryable: true, requiredAction: 'RETRY_LATER' }),
        };
      }
      return {
        httpStatus: 200,
        body: {
          customerId: outcome.context.customerId,
          ...(outcome.context.safeDisplayName !== undefined ? { safeDisplayName: outcome.context.safeDisplayName } : {}),
          status: outcome.context.status,
          identities: outcome.context.identities,
          ...(orders.status === 'FOUND' ? { orders: orders.orders.map(serializeOrder) } : {}),
        },
      };
    }
    case 'NOT_FOUND':
      return { httpStatus: 404, body: { code: 'NOT_FOUND', requestId } };
    case 'STORE_ERROR':
      return {
        httpStatus: 500,
        body: safeHttpErrorEnvelope({ code: 'INTERNAL_UNEXPECTED', requestId, retryable: true, requiredAction: 'RETRY_LATER' }),
      };
  }
}

type OrdersInclusionOutcome =
  | { readonly status: 'FOUND'; readonly orders: readonly CustomerOrderSummary[] }
  | { readonly status: 'NOT_AUTHORIZED' }
  | { readonly status: 'STORE_ERROR' };

async function readOrdersIfAuthorized(
  request: CustomerContextHttpRequest,
  merchantWorkspaceId: MerchantWorkspaceId,
): Promise<OrdersInclusionOutcome> {
  const orderAuthorization = await evaluateAuthorization({
    executionContext: request.executionContext,
    requiredPermission: 'commerce.order:read',
    target: {
      owningOrganizationId: request.executionContext.actorOrganizationId,
      merchantWorkspaceId,
      resourceType: 'customer',
      resourceId: request.customerId,
    },
    module: 'commerce',
    membershipCandidates: request.membershipCandidates,
    agencyAssignmentCandidates: request.agencyAssignmentCandidates,
    roleReader: request.roleReader,
  });
  if (orderAuthorization.decision === 'DENY') return { status: 'NOT_AUTHORIZED' };

  const ordersOutcome = await request.ordersStore.readRecentOrders(request.customerId, merchantWorkspaceId);
  if (ordersOutcome.status === 'STORE_ERROR') return { status: 'STORE_ERROR' };
  return { status: 'FOUND', orders: ordersOutcome.orders };
}

type CustomerContextRouteContext = Context<{ Variables: CustomerContextRouteVariables }>;

async function runCustomerContextRoute(c: CustomerContextRouteContext): Promise<Response> {
  const executionContext = c.get('executionContext');
  const roleReader = c.get('roleReader');
  const store = c.get('customerContextStore');
  const ordersStore = c.get('customerOrdersStore');
  if (!executionContext || !roleReader || !store || !ordersStore) {
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
    ordersStore,
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
