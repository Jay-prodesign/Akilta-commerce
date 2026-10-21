import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import app from '../../apps/api/src/worker';
import { registerMessageDraftRoutes, type MessageDraftRouteVariables } from '../../apps/api/src/message-draft-route';
import { createMessageDraftStore, type MessageDraftQueryExecutor, type MessageDraftRecord } from '../../apps/api/src/message-draft-store';
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
  type IdempotencyKey,
  type Membership,
  type MerchantWorkspaceId,
  type OrganizationId,
} from '../../packages/domain/src';

const merchantA: OrganizationId = internalId('draft-workers-org-a', 'Organization');
const workspaceA: MerchantWorkspaceId = internalId('draft-workers-ws-a', 'MerchantWorkspace');
const userId = internalId('draft-workers-user-1', 'User');
const membershipId = internalId('draft-workers-membership-1', 'Membership');

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
    requestId: internalId('draft-workers-request-1', 'Request'),
    runId: internalId('draft-workers-run-1', 'Run'),
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

function existingConversationExecutor(): MessageDraftQueryExecutor {
  return {
    query: (sql) => {
      if (sql.startsWith('SELECT 1')) return Promise.resolve({ rows: [{ '?column?': 1 }] });
      return Promise.resolve({
        rows: [{ draft_id: 'draft-http-1', proposed_text: 'Thanks for reaching out!', created_by: userId, created_at: '2026-10-21T12:00:00.000Z' }],
      });
    },
  };
}

function buildTestApp(appliedIdempotencyKeys: ReadonlyMap<IdempotencyKey, MessageDraftRecord> = new Map()) {
  const testApp = new Hono<{ Variables: MessageDraftRouteVariables }>();
  testApp.use('*', async (c, next) => {
    c.set('executionContext', executionContext());
    c.set('membershipCandidates', membership());
    c.set('agencyAssignmentCandidates', []);
    c.set('roleReader', roleReader());
    c.set('messageDraftStore', createMessageDraftStore(existingConversationExecutor()));
    c.set('appliedMessageDraftIdempotencyKeys', appliedIdempotencyKeys);
    await next();
  });
  registerMessageDraftRoutes(testApp);
  return testApp;
}

describe('message draft HTTP route', () => {
  it('fails closed with 500 SESSION_CONTEXT_NOT_RESOLVED against the real unmodified production worker', async () => {
    const response = await app.request('https://worker.test/v1/conversations/conv-1/messages/draft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ proposedText: 'hi', idempotencyKey: 'key-1' }),
    });
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ code: 'SESSION_CONTEXT_NOT_RESOLVED' });
  });

  it('returns a real 200 draft creation end-to-end over HTTP', async () => {
    const testApp = buildTestApp();
    const response = await testApp.request('https://worker.test/v1/conversations/conv-1/messages/draft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ proposedText: 'Thanks for reaching out!', idempotencyKey: 'key-1' }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      draftId: 'draft-http-1',
      proposedText: 'Thanks for reaching out!',
      status: 'DRAFT',
      replay: false,
    });
  });

  it('returns a real 400 over HTTP when proposedText is missing', async () => {
    const testApp = buildTestApp();
    const response = await testApp.request('https://worker.test/v1/conversations/conv-1/messages/draft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idempotencyKey: 'key-1' }),
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({ error: 'INVALID_REQUEST', field: 'proposedText' });
  });

  it('returns a real 403 over HTTP when the role lacks conversation:respond', async () => {
    const testApp = new Hono<{ Variables: MessageDraftRouteVariables }>();
    testApp.use('*', async (c, next) => {
      c.set('executionContext', executionContext());
      c.set('membershipCandidates', membership());
      c.set('agencyAssignmentCandidates', []);
      c.set('roleReader', { read: () => Promise.resolve({ outcome: 'READ_SUCCESS', roleKeys: ['CLIENT_ANALYST'] }) });
      c.set('messageDraftStore', createMessageDraftStore(existingConversationExecutor()));
      c.set('appliedMessageDraftIdempotencyKeys', new Map());
      await next();
    });
    registerMessageDraftRoutes(testApp);
    const response = await testApp.request('https://worker.test/v1/conversations/conv-1/messages/draft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ proposedText: 'hi', idempotencyKey: 'key-1' }),
    });
    expect(response.status).toBe(403);
  });
});
