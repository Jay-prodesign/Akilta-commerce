import { Hono, type Context } from 'hono';

import { evaluateAuthorization } from '../../../packages/authz/src';
import type { ExecutionContext, MembershipRoleReader } from '../../../packages/authz/src';
import { utcTimestamp, type AgencyClientAssignment, type Membership } from '../../../packages/domain/src';
import { safeHttpErrorEnvelope, serializeMoneyForHttp, type SafeHttpErrorEnvelope } from './transport-contracts';
import type { UsageSummaryStore } from './usage-summary-store';

/**
 * AC-CCIA-001 — real HTTP wiring for the Control Center's `GET /v1/usage/summary` read operation
 * (`CONTROL_CENTER_OPERATIONS`, transport-contracts.ts), gated by `analytics:read` (already mapped
 * to `CLIENT_ANALYST`/`AGENCY_ANALYST` in the current `ROLE_PERMISSION_POLICY` — unlike
 * `integration:read`/`merchant_rule:*`/`approval:approve`/`security:audit_read`, which remain
 * deliberately unmapped broader-RBAC-bundle decisions this unit does not self-invent). Composes
 * only already-built authority: `evaluateAuthorization` + `createUsageSummaryStore` (which itself
 * composes the pure, non-authority `summarizeUsageEvents` projection).
 *
 * Range is server-computed (last 30 days ending now), never client-supplied — keeps this unit's
 * scope to exactly the contract table's path/method, with no new date-range query-param validation
 * surface invented. A later unit may add explicit `from`/`to` query parameters; this one does not.
 *
 * Same deliberately-deferred boundaries as `conversation-handoff-route.ts`, not repeated here:
 * session/identity middleware, a durable idempotency ledger (not applicable — this route performs
 * no mutation), a live Postgres connection, and independent workspace-ownership verification.
 */

export interface UsageSummaryRouteVariables {
  executionContext: ExecutionContext;
  membershipCandidates: readonly Membership[];
  agencyAssignmentCandidates: readonly AgencyClientAssignment[];
  roleReader: MembershipRoleReader;
  usageSummaryStore: UsageSummaryStore;
  /** Injected clock for test determinism; real deployments may simply leave this unset. */
  usageSummaryNow: Date;
}

export interface UsageSummaryHttpModuleRow {
  readonly module: string;
  readonly eventCount: number;
  readonly knownCostByCurrency: readonly { readonly amountMinor: string; readonly currency: string }[];
  readonly unknownCostEventCount: number;
}

export interface UsageSummaryHttpSuccessBody {
  readonly merchantWorkspaceId: unknown;
  readonly rangeStart: unknown;
  readonly rangeEnd: unknown;
  readonly computedAt: unknown;
  readonly totalEventCount: number;
  readonly byModule: readonly UsageSummaryHttpModuleRow[];
}

export type UsageSummaryHttpResult =
  | { readonly httpStatus: 200; readonly body: UsageSummaryHttpSuccessBody }
  | { readonly httpStatus: 403; readonly body: SafeHttpErrorEnvelope }
  | { readonly httpStatus: 500; readonly body: SafeHttpErrorEnvelope };

const SUMMARY_RANGE_DAYS = 30;

export interface UsageSummaryHttpRequest {
  readonly executionContext: ExecutionContext;
  readonly membershipCandidates: readonly Membership[];
  readonly agencyAssignmentCandidates: readonly AgencyClientAssignment[];
  readonly roleReader: MembershipRoleReader;
  readonly store: UsageSummaryStore;
  readonly now: Date;
}

export async function handleUsageSummaryRequest(request: UsageSummaryHttpRequest): Promise<UsageSummaryHttpResult> {
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
    requiredPermission: 'analytics:read',
    target: {
      owningOrganizationId: request.executionContext.actorOrganizationId,
      merchantWorkspaceId,
      resourceType: 'usage_summary',
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

  const rangeEnd = utcTimestamp(request.now);
  const rangeStart = utcTimestamp(new Date(request.now.getTime() - SUMMARY_RANGE_DAYS * 24 * 60 * 60 * 1000));
  const computedAt = rangeEnd;

  const outcome = await request.store.readSummary(merchantWorkspaceId, rangeStart, rangeEnd, computedAt);
  if (outcome.status === 'STORE_ERROR') {
    return {
      httpStatus: 500,
      body: safeHttpErrorEnvelope({ code: 'INTERNAL_UNEXPECTED', requestId, retryable: true, requiredAction: 'RETRY_LATER' }),
    };
  }

  const { summary } = outcome;
  return {
    httpStatus: 200,
    body: {
      merchantWorkspaceId: summary.merchantWorkspaceId,
      rangeStart: summary.rangeStart,
      rangeEnd: summary.rangeEnd,
      computedAt: summary.computedAt,
      totalEventCount: summary.totalEventCount,
      byModule: summary.byModule.map((row) => ({
        module: row.module,
        eventCount: row.eventCount,
        knownCostByCurrency: row.knownCostByCurrency.map(serializeMoneyForHttp),
        unknownCostEventCount: row.unknownCostEventCount,
      })),
    },
  };
}

type UsageSummaryRouteContext = Context<{ Variables: UsageSummaryRouteVariables }>;

async function runUsageSummaryRoute(c: UsageSummaryRouteContext): Promise<Response> {
  const executionContext = c.get('executionContext');
  const roleReader = c.get('roleReader');
  const store = c.get('usageSummaryStore');
  if (!executionContext || !roleReader || !store) {
    return new Response(JSON.stringify({ code: 'SESSION_CONTEXT_NOT_RESOLVED' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const result = await handleUsageSummaryRequest({
    executionContext,
    membershipCandidates: c.get('membershipCandidates') ?? [],
    agencyAssignmentCandidates: c.get('agencyAssignmentCandidates') ?? [],
    roleReader,
    store,
    now: c.get('usageSummaryNow') ?? new Date(),
  });

  return new Response(JSON.stringify(result.body), {
    status: result.httpStatus,
    headers: { 'content-type': 'application/json' },
  });
}

export function registerUsageSummaryRoutes(
  app: Hono<{ Variables: UsageSummaryRouteVariables }>,
): Hono<{ Variables: UsageSummaryRouteVariables }> {
  app.get('/v1/usage/summary', (c) => runUsageSummaryRoute(c));
  return app;
}
