import {
  handleConversationListRequest,
  type ConversationListHttpRequest,
} from '../../apps/api/src/conversation-list-route';
import { createConversationListStore, type ConversationListQueryExecutor } from '../../apps/api/src/conversation-list-store';
import {
  permission,
  resolvePermissionAuthoritySnapshot,
  ROLE_PERMISSION_POLICY,
  type ExecutionContext,
  type MembershipRoleReader,
} from '../../packages/authz/src';
import {
  agencyClientAssignmentId,
  internalId,
  localeTag,
  moduleKey,
  operationalStatus,
  utcTimestamp,
  type AgencyClientAssignment,
  type Membership,
  type MerchantWorkspaceId,
  type OrganizationId,
} from '../../packages/domain/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const merchantA: OrganizationId = internalId('conv-list-route-org-a', 'Organization');
const workspaceA: MerchantWorkspaceId = internalId('conv-list-route-ws-a', 'MerchantWorkspace');
const userId = internalId('conv-list-route-user-1', 'User');
const membershipId = internalId('conv-list-route-membership-1', 'Membership');

const grantedRoleKey = 'CLIENT_SUPPORT_AGENT';
const currentPermissionAuthority = resolvePermissionAuthoritySnapshot(
  membershipId,
  workspaceA,
  [grantedRoleKey],
  ROLE_PERMISSION_POLICY,
);
if (currentPermissionAuthority.outcome !== 'RESOLVED') {
  throw new Error('fixture misconfigured: expected a resolvable permission authority snapshot');
}
const currentPermissionSnapshotRef = currentPermissionAuthority.snapshot.authorityVersion;

const agencyOrgId: OrganizationId = internalId('conv-list-route-agency-a', 'Organization');
const agencyAssignmentId = agencyClientAssignmentId('conv-list-route-assignment-1');

function agencyAssignment(allowedModules: readonly string[]): AgencyClientAssignment {
  return {
    assignmentId: agencyAssignmentId,
    agencyOrganizationId: agencyOrgId,
    merchantWorkspaceId: workspaceA,
    allowedModules: allowedModules.map(moduleKey),
    permissionOverrideRefs: [],
    approvalAuthorityRefs: [],
    status: operationalStatus('ACTIVE'),
  };
}

function agencyExecutionContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return baseExecutionContext({
    actorOrganizationId: agencyOrgId,
    actorOrganizationType: 'AGENCY',
    agencyClientAssignmentId: agencyAssignmentId,
    ...overrides,
  });
}

function agencyMembership(): readonly Membership[] {
  return [{ membershipId, userId, organizationId: agencyOrgId, roleRefs: [], status: operationalStatus('ACTIVE') }];
}

function roleReader(roleKeys: readonly string[] = [grantedRoleKey]): MembershipRoleReader {
  return { read: () => Promise.resolve({ outcome: 'READ_SUCCESS', roleKeys }) };
}

function membership(): readonly Membership[] {
  return [{ membershipId, userId, organizationId: merchantA, roleRefs: [], status: operationalStatus('ACTIVE') }];
}

function baseExecutionContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    actorUserId: userId,
    actorOrganizationId: merchantA,
    actorOrganizationType: 'STANDALONE_MERCHANT',
    membershipId,
    membershipStatus: operationalStatus('ACTIVE'),
    activeMerchantWorkspaceId: workspaceA,
    permissionSnapshotRef: currentPermissionSnapshotRef,
    permissionGrants: [
      {
        permission: permission('conversation:read'),
        scope: { kind: 'MERCHANT_WORKSPACE', merchantWorkspaceId: workspaceA },
        sourceRef: 'claimed-cache-only',
      },
    ],
    assuranceLevel: 'STANDARD',
    channel: 'web',
    requestId: internalId('conv-list-route-request-1', 'Request'),
    runId: internalId('conv-list-route-run-1', 'Run'),
    locale: localeTag('tr-TR'),
    occurredAt: utcTimestamp('2026-10-16T12:00:00Z'),
    ...overrides,
  };
}

function emptyExecutor(): ConversationListQueryExecutor {
  return { query: () => Promise.resolve({ rows: [] }) };
}

function baseRequest(overrides: Partial<ConversationListHttpRequest> = {}): ConversationListHttpRequest {
  return {
    executionContext: baseExecutionContext(),
    membershipCandidates: membership(),
    agencyAssignmentCandidates: [],
    roleReader: roleReader(),
    store: createConversationListStore(emptyExecutor()),
    ...overrides,
  };
}

const cases: ReadonlyArray<{ readonly id: string; readonly run: () => Promise<void> }> = [
  {
    id: 'CONVLISTROUTE-01-AUTHORIZED-READ-RETURNS-200-WITH-REAL-DATA',
    run: async () => {
      const store = createConversationListStore({
        query: () =>
          Promise.resolve({
            rows: [
              {
                conversation_id: 'conv-1',
                channel: 'whatsapp',
                ownership_state: 'HUMAN_ACTIVE',
                ownership_epoch: 1,
                status: 'OPEN',
              },
            ],
          }),
      });
      const result = await handleConversationListRequest(baseRequest({ store }));
      assert(result.httpStatus === 200, 'an authorized caller with conversation:read must get a 200');
      assert(
        result.httpStatus === 200 && result.body.conversations.length === 1 && result.body.conversations[0]!.conversationId === 'conv-1',
        'the response must carry the real conversation row',
      );
    },
  },
  {
    id: 'CONVLISTROUTE-02-NO-ACTIVE-WORKSPACE-DENIES-403-BEFORE-ANY-STORE-CALL',
    run: async () => {
      let storeCalled = false;
      const store = createConversationListStore({
        query: () => {
          storeCalled = true;
          return Promise.resolve({ rows: [] });
        },
      });
      const result = await handleConversationListRequest(
        baseRequest({ executionContext: baseExecutionContext({ activeMerchantWorkspaceId: null }), store }),
      );
      assert(result.httpStatus === 403, 'a caller with no bound active workspace must be denied');
      assert(!storeCalled, 'the conversation list store must never be queried before tenancy/authorization is established');
    },
  },
  {
    id: 'CONVLISTROUTE-03-MISSING-CONVERSATION-READ-PERMISSION-DENIES-403-BEFORE-ANY-STORE-CALL',
    run: async () => {
      let storeCalled = false;
      const store = createConversationListStore({
        query: () => {
          storeCalled = true;
          return Promise.resolve({ rows: [] });
        },
      });
      // CLIENT_ANALYST has no conversation:read grant in ROLE_PERMISSION_POLICY.
      const result = await handleConversationListRequest(baseRequest({ roleReader: roleReader(['CLIENT_ANALYST']), store }));
      assert(result.httpStatus === 403, 'a role lacking conversation:read must be denied');
      assert(!storeCalled, 'authorization must fail closed before the conversation list store is ever queried');
    },
  },
  {
    id: 'CONVLISTROUTE-04-STORE-ERROR-RETURNS-RETRYABLE-500',
    run: async () => {
      const store = createConversationListStore({ query: () => Promise.reject(new Error('connection lost')) });
      const result = await handleConversationListRequest(baseRequest({ store }));
      assert(
        result.httpStatus === 500 && 'retryable' in result.body && result.body.retryable === true,
        'a real read failure must surface as a retryable 500, never a false empty 200',
      );
    },
  },
  {
    id: 'CONVLISTROUTE-05-EMPTY-WORKSPACE-RETURNS-A-REAL-EMPTY-200-NOT-AN-ERROR',
    run: async () => {
      const result = await handleConversationListRequest(baseRequest());
      assert(
        result.httpStatus === 200 && result.body.conversations.length === 0,
        'a workspace with zero conversations must be a real empty 200 list, never an error',
      );
    },
  },
  {
    id: 'CONVLISTROUTE-06-AGENCY-WITH-MODULE-RESTRICTION-EXCLUDING-CONVERSATION-DENIES-403-BEFORE-ANY-STORE-CALL',
    run: async () => {
      let storeCalled = false;
      const store = createConversationListStore({
        query: () => {
          storeCalled = true;
          return Promise.resolve({ rows: [] });
        },
      });
      const result = await handleConversationListRequest(
        baseRequest({
          executionContext: agencyExecutionContext(),
          membershipCandidates: agencyMembership(),
          agencyAssignmentCandidates: [agencyAssignment(['commerce'])],
          store,
        }),
      );
      assert(
        result.httpStatus === 403,
        "an agency whose current AgencyClientAssignment does not include the 'conversation' module must be denied, even with a role that grants conversation:read",
      );
      assert(!storeCalled, 'the conversation list store must never be queried when the agency module allowlist excludes this operation');
    },
  },
];

async function main() {
  for (const testCase of cases) {
    await testCase.run();
    console.log(`PASS ${testCase.id}`);
  }
  console.log(`PASS ${cases.length}/${cases.length} conversation list HTTP route scenarios`);
}

void main();
