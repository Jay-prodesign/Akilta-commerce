import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import app from '../../apps/api/src/worker';
import { registerUsageSummaryRoutes, type UsageSummaryRouteVariables } from '../../apps/api/src/usage-summary-route';
import { createUsageSummaryStore, type UsageSummaryQueryExecutor } from '../../apps/api/src/usage-summary-store';
import {
  permission,
  resolvePermissionAuthoritySnapshot,
  ROLE_PERMISSION_POLICY,
  type ExecutionContext,
  type MembershipRoleReader,
} from '../../packages/authz/src';
import {
  internalId,
  localeTag,
  operationalStatus,
  utcTimestamp,
  type Membership,
  type MerchantWorkspaceId,
  type OrganizationId,
} from '../../packages/domain/src';

/**
 * Real Hono/Workers-runtime HTTP round trip for GET /v1/usage/summary, mirroring
 * tests/runtime/conversation-handoff-route.spec.ts's approach: an isolated test app registering the
 * exact same production route-handler code, preceded only by a test-only middleware populating the
 * per-request authority dependencies a future session middleware is responsible for in production.
 */

const merchantA: OrganizationId = internalId('usage-workers-org-a', 'Organization');
const workspaceA: MerchantWorkspaceId = internalId('usage-workers-ws-a', 'MerchantWorkspace');
const userId = internalId('usage-workers-user-1', 'User');
const membershipId = internalId('usage-workers-membership-1', 'Membership');

const grantedRoleKey = 'CLIENT_ANALYST';
const snapshot = resolvePermissionAuthoritySnapshot(membershipId, workspaceA, [grantedRoleKey], ROLE_PERMISSION_POLICY);
if (snapshot.outcome !== 'RESOLVED') throw new Error('fixture misconfigured');
const permissionSnapshotRef = snapshot.snapshot.authorityVersion;

function executionContext(): ExecutionContext {
  return {
    actorUserId: userId,
    actorOrganizationId: merchantA,
    actorOrganizationType: 'STANDALONE_MERCHANT',
    membershipId,
    membershipStatus: operationalStatus('ACTIVE'),
    activeMerchantWorkspaceId: workspaceA,
    permissionSnapshotRef,
    permissionGrants: [
      {
        permission: permission('analytics:read'),
        scope: { kind: 'MERCHANT_WORKSPACE', merchantWorkspaceId: workspaceA },
        sourceRef: 'claimed-cache-only',
      },
    ],
    assuranceLevel: 'STANDARD',
    channel: 'web',
    requestId: internalId('usage-workers-request-1', 'Request'),
    runId: internalId('usage-workers-run-1', 'Run'),
    locale: localeTag('tr-TR'),
    occurredAt: utcTimestamp('2026-10-16T12:00:00Z'),
  };
}

function roleReader(): MembershipRoleReader {
  return { read: () => Promise.resolve({ outcome: 'READ_SUCCESS', roleKeys: [grantedRoleKey] }) };
}

function membership(): readonly Membership[] {
  return [{ membershipId, userId, organizationId: merchantA, roleRefs: [], status: operationalStatus('ACTIVE') }];
}

function fakeExecutor(rows: readonly Record<string, unknown>[]): UsageSummaryQueryExecutor {
  return { query: () => Promise.resolve({ rows }) };
}

function buildTestApp(rows: readonly Record<string, unknown>[]) {
  const testApp = new Hono<{ Variables: UsageSummaryRouteVariables }>();
  testApp.use('*', async (c, next) => {
    c.set('executionContext', executionContext());
    c.set('membershipCandidates', membership());
    c.set('agencyAssignmentCandidates', []);
    c.set('roleReader', roleReader());
    c.set('usageSummaryStore', createUsageSummaryStore(fakeExecutor(rows)));
    c.set('usageSummaryNow', new Date('2026-10-16T12:00:00Z'));
    await next();
  });
  registerUsageSummaryRoutes(testApp);
  return testApp;
}

describe('usage summary HTTP route', () => {
  it('fails closed with 500 SESSION_CONTEXT_NOT_RESOLVED against the real unmodified production worker', async () => {
    const response = await app.request('https://worker.test/v1/usage/summary');
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ code: 'SESSION_CONTEXT_NOT_RESOLVED' });
  });

  it('returns a real 200 usage summary end-to-end over HTTP', async () => {
    const testApp = buildTestApp([
      {
        usage_event_id: 'ue-1',
        module: 'conversation.ai_reply',
        run_id: null,
        correlation_id: null,
        logical_operation_ref: 'op-1',
        provider_type: 'openai',
        provider_operation: 'chat.completion',
        quantity: '100',
        unit: 'token',
        rate_card_version: 'rc-v1',
        provider_cost_amount_minor: '250',
        provider_cost_currency: 'USD',
        estimated_flag: false,
        reconciliation_state: 'SETTLED',
        provider_usage_ref: null,
        occurred_at: '2026-10-15T10:00:00.000Z',
      },
    ]);
    const response = await testApp.request('https://worker.test/v1/usage/summary');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      merchantWorkspaceId: workspaceA,
      totalEventCount: 1,
      byModule: [
        {
          module: 'conversation.ai_reply',
          eventCount: 1,
          knownCostByCurrency: [{ amountMinor: '250', currency: 'USD' }],
          unknownCostEventCount: 0,
        },
      ],
    });
  });

  it('returns a real 403 over HTTP when the role lacks analytics:read', async () => {
    const testApp = new Hono<{ Variables: UsageSummaryRouteVariables }>();
    testApp.use('*', async (c, next) => {
      c.set('executionContext', executionContext());
      c.set('membershipCandidates', membership());
      c.set('agencyAssignmentCandidates', []);
      c.set('roleReader', { read: () => Promise.resolve({ outcome: 'READ_SUCCESS', roleKeys: ['CLIENT_SUPPORT_AGENT'] }) });
      c.set('usageSummaryStore', createUsageSummaryStore(fakeExecutor([])));
      c.set('usageSummaryNow', new Date('2026-10-16T12:00:00Z'));
      await next();
    });
    registerUsageSummaryRoutes(testApp);
    const response = await testApp.request('https://worker.test/v1/usage/summary');
    expect(response.status).toBe(403);
  });
});
