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
  createIdempotencyLedgerStore,
  type IdempotencyLedgerQueryExecutor,
  type IdempotencyLedgerReadOutcome,
  type IdempotencyLedgerStore,
} from '../../apps/api/src/idempotency-ledger-store';
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

function fakeLedger(overrides: Partial<IdempotencyLedgerStore> = {}): IdempotencyLedgerStore {
  return {
    tryGet: (): Promise<IdempotencyLedgerReadOutcome> => Promise.resolve({ status: 'NOT_FOUND' }),
    record: () => Promise.resolve({ status: 'RECORDED' }),
    ...overrides,
  };
}

// A genuine in-memory simulation of the real `idempotency_records` table, used by the cross-identity
// non-collision test so it proves the real scoping behavior over actual HTTP, not a mocked call.
function statefulLedgerExecutor(): IdempotencyLedgerQueryExecutor {
  const rows = new Map<string, string>();
  function rowKey(params: readonly unknown[]): string {
    return JSON.stringify([params[0], params[1], params[2]]);
  }
  return {
    query: (sql, params) => {
      if (sql.includes('INSERT INTO idempotency_records')) {
        const rkey = rowKey(params);
        if (rows.has(rkey)) return Promise.resolve({ rows: [] });
        const snapshot = String(params[3]);
        rows.set(rkey, snapshot);
        return Promise.resolve({ rows: [{ result_snapshot: snapshot }] });
      }
      const rkey = rowKey(params);
      return Promise.resolve({ rows: rows.has(rkey) ? [{ result_snapshot: rows.get(rkey) }] : [] });
    },
  };
}

function buildTestApp(ledger: IdempotencyLedgerStore = fakeLedger(), executor: CustomerIdentityLinkQueryExecutor = unlinkedExecutor()) {
  const testApp = new Hono<{ Variables: CustomerIdentityLinkRouteVariables }>();
  testApp.use('*', async (c, next) => {
    c.set('executionContext', executionContext());
    c.set('membershipCandidates', membership());
    c.set('agencyAssignmentCandidates', []);
    c.set('roleReader', roleReader());
    c.set('customerIdentityLinkStore', createCustomerIdentityLinkStore(executor, ledger));
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

  it('returns a real 200 ledger replay over HTTP, never re-reaching the CAS update', async () => {
    const priorSnapshot = { customerId: 'cust-prior', generation: 1 };
    const testApp = buildTestApp(fakeLedger({ tryGet: () => Promise.resolve({ status: 'FOUND', resultSnapshot: priorSnapshot }) }));
    const response = await testApp.request('https://worker.test/v1/customer-identities/identity-1/link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation: 'LINK', targetCustomerId: 'cust-ignored', expectedGeneration: 0, idempotencyKey: 'key-1' }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ customerId: 'cust-prior', generation: 1, replay: true });
  });

  it('returns a real 200 over HTTP when the ledger write fails, reporting replay:false and ledgerWriteFailed:true', async () => {
    const testApp = buildTestApp(fakeLedger({ record: () => Promise.resolve({ status: 'STORE_ERROR' }) }));
    const response = await testApp.request('https://worker.test/v1/customer-identities/identity-1/link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation: 'LINK', targetCustomerId: 'cust-http-1', expectedGeneration: 0, idempotencyKey: 'key-1' }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ customerId: 'cust-http-1', replay: false, ledgerWriteFailed: true });
  });

  it('scopes the idempotency ledger lookup by identity against the real ledger, so two identities sharing the same raw key never collide', async () => {
    const sharedRealLedger = createIdempotencyLedgerStore(statefulLedgerExecutor());
    const sharedRawKey = 'shared-caller-key';

    // identity-A LINKs first with the shared raw key.
    const testAppA = buildTestApp(sharedRealLedger);
    const responseA = await testAppA.request('https://worker.test/v1/customer-identities/identity-A/link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation: 'LINK', targetCustomerId: 'cust-identity-a', expectedGeneration: 0, idempotencyKey: sharedRawKey }),
    });
    expect(responseA.status).toBe(200);
    await expect(responseA.json()).resolves.toMatchObject({ customerId: 'cust-identity-a', replay: false });

    // identity-B reuses the SAME raw key — must not replay identity-A's cached outcome.
    const testAppB = buildTestApp(sharedRealLedger);
    const responseB = await testAppB.request('https://worker.test/v1/customer-identities/identity-B/link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation: 'LINK', targetCustomerId: 'cust-http-1', expectedGeneration: 0, idempotencyKey: sharedRawKey }),
    });
    expect(responseB.status).toBe(200);
    const bodyB = await responseB.json();
    expect(bodyB).toMatchObject({ customerId: 'cust-http-1', replay: false });
  });

  it('returns a real 403 over HTTP when the role lacks conversation:respond', async () => {
    const testApp = new Hono<{ Variables: CustomerIdentityLinkRouteVariables }>();
    testApp.use('*', async (c, next) => {
      c.set('executionContext', executionContext());
      c.set('membershipCandidates', membership());
      c.set('agencyAssignmentCandidates', []);
      c.set('roleReader', { read: () => Promise.resolve({ outcome: 'READ_SUCCESS', roleKeys: ['CLIENT_ANALYST'] }) });
      c.set('customerIdentityLinkStore', createCustomerIdentityLinkStore(unlinkedExecutor(), fakeLedger()));
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
