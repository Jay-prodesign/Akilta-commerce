import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import app from '../../apps/api/src/worker';
import {
  registerConversationOwnershipRoutes,
  type ConversationOwnershipRouteVariables,
} from '../../apps/api/src/conversation-handoff-route';
import { createConversationOwnershipStore, type ConversationOwnershipQueryExecutor } from '../../apps/api/src/conversation-ownership-store';
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
 * Real Hono/Workers-runtime HTTP round trip for the conversation handoff / return-to-ai routes
 * registered in apps/api/src/worker.ts — executed through the actual Cloudflare Workers test pool
 * (same mechanism as tests/runtime/worker-health.spec.ts), not a mocked request object. This is the
 * one piece the tests/security/conversation-handoff-route.spec.ts plain-function suite cannot cover:
 * real HTTP method/path routing, header/body parsing, and JSON response shaping dispatched by Hono
 * itself. It still carries no live Postgres and no live session — those remain explicitly
 * out-of-scope runtime-dependency concerns per RUNTIME_DEPENDENCY_TESTS_NOT_RUN.
 */

const merchantA: OrganizationId = internalId('workers-org-a', 'Organization');
const workspaceA: MerchantWorkspaceId = internalId('workers-ws-a', 'MerchantWorkspace');
const userId = internalId('workers-user-1', 'User');
const membershipId = internalId('workers-membership-1', 'Membership');

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
        permission: permission('conversation:assign'),
        scope: { kind: 'MERCHANT_WORKSPACE', merchantWorkspaceId: workspaceA },
        sourceRef: 'claimed-cache-only',
      },
    ],
    assuranceLevel: 'STANDARD',
    channel: 'web',
    requestId: internalId('workers-request-1', 'Request'),
    runId: internalId('workers-run-1', 'Run'),
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

function fakeExecutor(initialRow: Record<string, unknown> | null): ConversationOwnershipQueryExecutor {
  let row = initialRow;
  return {
    query(sql, params) {
      if (sql.startsWith('SELECT')) return Promise.resolve({ rows: row ? [row] : [] });
      if (sql.includes('INSERT INTO conversation_ownership_events')) return Promise.resolve({ rows: [] });
      const [newState, newEpoch, , , expectedEpoch] = params;
      if (row === null || Number(row.ownership_epoch) !== Number(expectedEpoch)) return Promise.resolve({ rows: [] });
      row = { ownership_state: newState, ownership_epoch: newEpoch };
      return Promise.resolve({ rows: [row] });
    },
  };
}

/**
 * Builds an isolated test app that registers the exact same route-handler code as production
 * worker.ts, preceded only by a test-only middleware populating the per-request authority
 * dependencies a future session middleware is responsible for in a real deployment.
 */
function buildTestApp(initialRow: Record<string, unknown> | null) {
  const testApp = new Hono<{ Variables: ConversationOwnershipRouteVariables }>();
  testApp.use('*', async (c, next) => {
    c.set('executionContext', executionContext());
    c.set('membershipCandidates', membership());
    c.set('agencyAssignmentCandidates', []);
    c.set('roleReader', roleReader());
    c.set('conversationOwnershipStore', createConversationOwnershipStore(fakeExecutor(initialRow)));
    c.set('appliedConversationOwnershipIdempotencyKeys', new Map());
    await next();
  });
  registerConversationOwnershipRoutes(testApp);
  return testApp;
}

describe('conversation handoff/return-to-ai HTTP routes', () => {
  it('returns the real health baseline unaffected by the new routes', async () => {
    const response = await app.request('https://worker.test/health');
    expect(response.status).toBe(200);
  });

  it('fails closed with 500 SESSION_CONTEXT_NOT_RESOLVED when no middleware has set the authority context (the real, unmodified production worker)', async () => {
    const response = await app.request('https://worker.test/v1/conversations/conv-1/handoff', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedEpoch: 0, idempotencyKey: 'wk-1' }),
    });
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ code: 'SESSION_CONTEXT_NOT_RESOLVED' });
  });

  it('applies a human-takeover handoff end-to-end over real HTTP and returns 200 with the new state', async () => {
    const testApp = buildTestApp({ ownership_state: 'AI_ACTIVE', ownership_epoch: 0 });
    const response = await testApp.request('https://worker.test/v1/conversations/conv-1/handoff', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedEpoch: 0, idempotencyKey: 'wk-handoff-1' }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      conversationId: 'conv-1',
      ownershipState: 'HUMAN_ACTIVE',
      epoch: 1,
      replay: false,
      auditWriteFailed: false,
    });
  });

  it('drives the return-to-ai route to RETURN_TO_AI_PENDING end-to-end over real HTTP', async () => {
    const testApp = buildTestApp({ ownership_state: 'HUMAN_ACTIVE', ownership_epoch: 1 });
    const response = await testApp.request('https://worker.test/v1/conversations/conv-1/return-to-ai', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedEpoch: 1, idempotencyKey: 'wk-return-1' }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ownershipState: 'RETURN_TO_AI_PENDING', epoch: 2 });
  });

  it('rejects a malformed body with a real 400, never reaching the store', async () => {
    const testApp = buildTestApp({ ownership_state: 'AI_ACTIVE', ownership_epoch: 0 });
    const response = await testApp.request('https://worker.test/v1/conversations/conv-1/handoff', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idempotencyKey: 'wk-bad-1' }),
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({ error: 'INVALID_REQUEST', field: 'expectedEpoch' });
  });

  it('returns a real 409 OWNERSHIP_CONFLICT over HTTP on a stale expected epoch', async () => {
    const testApp = buildTestApp({ ownership_state: 'AI_ACTIVE', ownership_epoch: 7 });
    const response = await testApp.request('https://worker.test/v1/conversations/conv-1/handoff', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedEpoch: 0, idempotencyKey: 'wk-conflict-1' }),
    });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'OWNERSHIP_CONFLICT', reason: 'STALE_EXPECTED_EPOCH' });
  });

  it('returns a real 404 for a conversation that does not exist in this workspace', async () => {
    const testApp = buildTestApp(null);
    const response = await testApp.request('https://worker.test/v1/conversations/conv-missing/handoff', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedEpoch: 0, idempotencyKey: 'wk-missing-1' }),
    });
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('reads current ownership state/epoch end-to-end over real HTTP (GET)', async () => {
    const testApp = buildTestApp({ ownership_state: 'HUMAN_ACTIVE', ownership_epoch: 3 });
    const response = await testApp.request('https://worker.test/v1/conversations/conv-1');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ conversationId: 'conv-1', ownershipState: 'HUMAN_ACTIVE', epoch: 3 });
  });

  it('returns a real 404 on GET for a conversation absent from this workspace', async () => {
    const testApp = buildTestApp(null);
    const response = await testApp.request('https://worker.test/v1/conversations/conv-missing');
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('fails closed with 500 SESSION_CONTEXT_NOT_RESOLVED on GET against the real unmodified production worker', async () => {
    const response = await app.request('https://worker.test/v1/conversations/conv-1');
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ code: 'SESSION_CONTEXT_NOT_RESOLVED' });
  });
});
