import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import app from '../../apps/api/src/worker';
import {
  registerCustomerIdentityLinkRoutes,
  type CustomerIdentityLinkRouteVariables,
} from '../../apps/api/src/customer-identity-link-route';
import {
  createCustomerIdentityLinkStore,
  type CustomerIdentityLinkQueryExecutor,
} from '../../apps/api/src/customer-identity-link-store';
import {
  permission,
  resolvePermissionAuthoritySnapshot,
  ROLE_PERMISSION_POLICY,
  type ExecutionContext,
  type MembershipRoleReader,
} from '../../packages/authz/src';
import type { CustomerIdentityLinkIdempotencyKey, CustomerIdentityLinkRecord } from '../../packages/authz/src/customer-identity-link-transition';
import {
  internalId,
  localeTag,
  operationalStatus,
  utcTimestamp,
  type Membership,
  type MerchantWorkspaceId,
  type OrganizationId,
} from '../../packages/domain/src';

const merchantA: OrganizationId = internalId('xcid-workers-org-a', 'Organization');
const workspaceA: MerchantWorkspaceId = internalId('xcid-workers-ws-a', 'MerchantWorkspace');
const userId = internalId('xcid-workers-user-1', 'User');
const membershipId = internalId('xcid-workers-membership-1', 'Membership');

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
        permission: permission('conversation:respond'),
        scope: { kind: 'MERCHANT_WORKSPACE', merchantWorkspaceId: workspaceA },
        sourceRef: 'claimed-cache-only',
      },
    ],
    assuranceLevel: 'STANDARD',
    channel: 'web',
    requestId: internalId('xcid-workers-request-1', 'Request'),
    runId: internalId('xcid-workers-run-1', 'Run'),
    locale: localeTag('tr-TR'),
    occurredAt: utcTimestamp('2026-10-21T12:00:00Z'),
  };
}

function roleReader(): MembershipRoleReader {
  return { read: () => Promise.resolve({ outcome: 'READ_SUCCESS', roleKeys: [grantedRoleKey] }) };
}

function membership(): readonly Membership[] {
  return [{ membershipId, userId, organizationId: merchantA, roleRefs: [], status: operationalStatus('ACTIVE') }];
}

function unlinkedExecutor(): CustomerIdentityLinkQueryExecutor {
  return {
    query: (sql) => {
      if (sql.startsWith('SELECT')) return Promise.resolve({ rows: [{ customer_id: null, link_generation: 0 }] });
      if (sql.includes('INSERT INTO customer_identity_link_events')) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [{ customer_id: 'cust-http-1', link_generation: 1 }] });
    },
  };
}

function buildTestApp(
  appliedIdempotencyKeys: ReadonlyMap<CustomerIdentityLinkIdempotencyKey, CustomerIdentityLinkRecord> = new Map(),
) {
  const testApp = new Hono<{ Variables: CustomerIdentityLinkRouteVariables }>();
  testApp.use('*', async (c, next) => {
    c.set('executionContext', executionContext());
    c.set('membershipCandidates', membership());
    c.set('agencyAssignmentCandidates', []);
    c.set('roleReader', roleReader());
    c.set('customerIdentityLinkStore', createCustomerIdentityLinkStore(unlinkedExecutor()));
    c.set('appliedCustomerIdentityLinkIdempotencyKeys', appliedIdempotencyKeys);
    await next();
  });
  registerCustomerIdentityLinkRoutes(testApp);
  return testApp;
}

describe('customer identity link HTTP route', () => {
  it('fails closed with 500 SESSION_CONTEXT_NOT_RESOLVED against the real unmodified production worker', async () => {
    const response = await app.request('https://worker.test/v1/customer-identities/identity-1/link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation: 'LINK', targetCustomerId: 'cust-1', expectedGeneration: 0, idempotencyKey: 'key-1' }),
    });
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ code: 'SESSION_CONTEXT_NOT_RESOLVED' });
  });

  it('returns a real 200 LINK end-to-end over HTTP', async () => {
    const testApp = buildTestApp();
    const response = await testApp.request('https://worker.test/v1/customer-identities/identity-1/link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation: 'LINK', targetCustomerId: 'cust-http-1', expectedGeneration: 0, idempotencyKey: 'key-1' }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ customerId: 'cust-http-1', generation: 1, replay: false });
  });

  it('returns a real 400 over HTTP when operation is missing/invalid', async () => {
    const testApp = buildTestApp();
    const response = await testApp.request('https://worker.test/v1/customer-identities/identity-1/link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetCustomerId: 'cust-1', expectedGeneration: 0, idempotencyKey: 'key-1' }),
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({ error: 'INVALID_REQUEST', field: 'operation' });
  });

  it('returns a real 400 over HTTP for an empty-string targetCustomerId, never an unhandled 500', async () => {
    const testApp = buildTestApp();
    const response = await testApp.request('https://worker.test/v1/customer-identities/identity-1/link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation: 'LINK', targetCustomerId: '', expectedGeneration: 0, idempotencyKey: 'key-1' }),
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({ error: 'INVALID_REQUEST', field: 'targetCustomerId' });
  });

  it('returns a real 403 over HTTP when the role lacks conversation:respond', async () => {
    const testApp = new Hono<{ Variables: CustomerIdentityLinkRouteVariables }>();
    testApp.use('*', async (c, next) => {
      c.set('executionContext', executionContext());
      c.set('membershipCandidates', membership());
      c.set('agencyAssignmentCandidates', []);
      c.set('roleReader', { read: () => Promise.resolve({ outcome: 'READ_SUCCESS', roleKeys: ['CLIENT_ANALYST'] }) });
      c.set('customerIdentityLinkStore', createCustomerIdentityLinkStore(unlinkedExecutor()));
      c.set('appliedCustomerIdentityLinkIdempotencyKeys', new Map());
      await next();
    });
    registerCustomerIdentityLinkRoutes(testApp);
    const response = await testApp.request('https://worker.test/v1/customer-identities/identity-1/link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation: 'LINK', targetCustomerId: 'cust-1', expectedGeneration: 0, idempotencyKey: 'key-1' }),
    });
    expect(response.status).toBe(403);
  });
});
