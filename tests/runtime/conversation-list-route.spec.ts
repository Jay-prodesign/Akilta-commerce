import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import app from '../../apps/api/src/worker';
import { registerConversationListRoutes, type ConversationListRouteVariables } from '../../apps/api/src/conversation-list-route';
import { createConversationListStore, type ConversationListQueryExecutor } from '../../apps/api/src/conversation-list-store';
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

const merchantA: OrganizationId = internalId('convlist-workers-org-a', 'Organization');
const workspaceA: MerchantWorkspaceId = internalId('convlist-workers-ws-a', 'MerchantWorkspace');
const userId = internalId('convlist-workers-user-1', 'User');
const membershipId = internalId('convlist-workers-membership-1', 'Membership');

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
        permission: permission('conversation:read'),
        scope: { kind: 'MERCHANT_WORKSPACE', merchantWorkspaceId: workspaceA },
        sourceRef: 'claimed-cache-only',
      },
    ],
    assuranceLevel: 'STANDARD',
    channel: 'web',
    requestId: internalId('convlist-workers-request-1', 'Request'),
    runId: internalId('convlist-workers-run-1', 'Run'),
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

function fakeExecutor(rows: readonly Record<string, unknown>[]): ConversationListQueryExecutor {
  return { query: () => Promise.resolve({ rows }) };
}

function buildTestApp(rows: readonly Record<string, unknown>[]) {
  const testApp = new Hono<{ Variables: ConversationListRouteVariables }>();
  testApp.use('*', async (c, next) => {
    c.set('executionContext', executionContext());
    c.set('membershipCandidates', membership());
    c.set('agencyAssignmentCandidates', []);
    c.set('roleReader', roleReader());
    c.set('conversationListStore', createConversationListStore(fakeExecutor(rows)));
    await next();
  });
  registerConversationListRoutes(testApp);
  return testApp;
}

describe('conversation list HTTP route', () => {
  it('fails closed with 500 SESSION_CONTEXT_NOT_RESOLVED against the real unmodified production worker', async () => {
    const response = await app.request('https://worker.test/v1/conversations');
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ code: 'SESSION_CONTEXT_NOT_RESOLVED' });
  });

  it('returns a real 200 conversation list end-to-end over HTTP', async () => {
    const testApp = buildTestApp([
      {
        conversation_id: 'conv-1',
        channel: 'whatsapp',
        customer_identity_id: 'cust-identity-1',
        ownership_state: 'HUMAN_ACTIVE',
        ownership_epoch: 2,
        assigned_user_id: 'user-1',
        status: 'OPEN',
        last_message_at: '2026-10-16T11:00:00.000Z',
        last_customer_message_at: '2026-10-16T10:55:00.000Z',
        last_outbound_at: '2026-10-16T11:00:00.000Z',
      },
    ]);
    const response = await testApp.request('https://worker.test/v1/conversations');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      conversations: [
        {
          conversationId: 'conv-1',
          channel: 'whatsapp',
          customerIdentityId: 'cust-identity-1',
          ownershipState: 'HUMAN_ACTIVE',
          ownershipEpoch: 2,
          assignedUserId: 'user-1',
          status: 'OPEN',
          lastMessageAt: '2026-10-16T11:00:00.000Z',
          lastCustomerMessageAt: '2026-10-16T10:55:00.000Z',
          lastOutboundAt: '2026-10-16T11:00:00.000Z',
        },
      ],
    });
  });

  it('returns a real 403 over HTTP when the role lacks conversation:read', async () => {
    const testApp = new Hono<{ Variables: ConversationListRouteVariables }>();
    testApp.use('*', async (c, next) => {
      c.set('executionContext', executionContext());
      c.set('membershipCandidates', membership());
      c.set('agencyAssignmentCandidates', []);
      c.set('roleReader', { read: () => Promise.resolve({ outcome: 'READ_SUCCESS', roleKeys: ['CLIENT_ANALYST'] }) });
      c.set('conversationListStore', createConversationListStore(fakeExecutor([])));
      await next();
    });
    registerConversationListRoutes(testApp);
    const response = await testApp.request('https://worker.test/v1/conversations');
    expect(response.status).toBe(403);
  });
});
