import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import app from '../../apps/api/src/worker';
import { registerCustomerContextRoutes, type CustomerContextRouteVariables } from '../../apps/api/src/customer-context-route';
import { createCustomerContextStore, type CustomerContextQueryExecutor } from '../../apps/api/src/customer-context-store';
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

const merchantA: OrganizationId = internalId('cctx-workers-org-a', 'Organization');
const workspaceA: MerchantWorkspaceId = internalId('cctx-workers-ws-a', 'MerchantWorkspace');
const userId = internalId('cctx-workers-user-1', 'User');
const membershipId = internalId('cctx-workers-membership-1', 'Membership');

const grantedRoleKey = 'CLIENT_SUPPORT_AGENT';
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
        permission: permission('customer:read'),
        scope: { kind: 'MERCHANT_WORKSPACE', merchantWorkspaceId: workspaceA },
        sourceRef: 'claimed-cache-only',
      },
    ],
    assuranceLevel: 'STANDARD',
    channel: 'web',
    requestId: internalId('cctx-workers-request-1', 'Request'),
    runId: internalId('cctx-workers-run-1', 'Run'),
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

function fakeExecutor(
  customerRows: readonly Record<string, unknown>[],
  identityRows: readonly Record<string, unknown>[] = [],
): CustomerContextQueryExecutor {
  return {
    query: (sql) => {
      if (sql.startsWith('SELECT customer_id')) return Promise.resolve({ rows: customerRows });
      return Promise.resolve({ rows: identityRows });
    },
  };
}

function buildTestApp(customerRows: readonly Record<string, unknown>[], identityRows: readonly Record<string, unknown>[] = []) {
  const testApp = new Hono<{ Variables: CustomerContextRouteVariables }>();
  testApp.use('*', async (c, next) => {
    c.set('executionContext', executionContext());
    c.set('membershipCandidates', membership());
    c.set('agencyAssignmentCandidates', []);
    c.set('roleReader', roleReader());
    c.set('customerContextStore', createCustomerContextStore(fakeExecutor(customerRows, identityRows)));
    await next();
  });
  registerCustomerContextRoutes(testApp);
  return testApp;
}

describe('customer context HTTP route', () => {
  it('fails closed with 500 SESSION_CONTEXT_NOT_RESOLVED against the real unmodified production worker', async () => {
    const response = await app.request('https://worker.test/v1/customers/cust-1/context');
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ code: 'SESSION_CONTEXT_NOT_RESOLVED' });
  });

  it('returns a real 200 customer context end-to-end over HTTP', async () => {
    const testApp = buildTestApp(
      [{ customer_id: 'cust-1', safe_display_name: 'Real Customer', status: 'ACTIVE' }],
      [{ channel_type: 'whatsapp', verification_level: 'CV2', verification_expires_at: null, status: 'ACTIVE' }],
    );
    const response = await testApp.request('https://worker.test/v1/customers/cust-1/context');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      customerId: 'cust-1',
      safeDisplayName: 'Real Customer',
      status: 'ACTIVE',
      identities: [{ channelType: 'whatsapp', verificationLevel: 'CV2', status: 'ACTIVE' }],
    });
  });

  it('returns a real 404 over HTTP for a customer absent from this workspace', async () => {
    const testApp = buildTestApp([]);
    const response = await testApp.request('https://worker.test/v1/customers/cust-missing/context');
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'NOT_FOUND' });
  });
});
