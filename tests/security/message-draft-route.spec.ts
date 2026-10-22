import {
  handleMessageDraftRequest,
  type MessageDraftHttpRequest,
} from '../../apps/api/src/message-draft-route';
import { createMessageDraftStore, type MessageDraftQueryExecutor } from '../../apps/api/src/message-draft-store';
import type { IdempotencyLedgerReadOutcome, IdempotencyLedgerStore } from '../../apps/api/src/idempotency-ledger-store';
import {
  permission,
  resolvePermissionAuthoritySnapshot,
  ROLE_PERMISSION_POLICY,
  type ExecutionContext,
  type MembershipRoleReader,
} from '../../packages/authz/src';
import {
  agencyClientAssignmentId,
  idempotencyKey,
  internalId,
  localeTag,
  moduleKey,
  operationalStatus,
  utcTimestamp,
  type AgencyClientAssignment,
  type ConversationId,
  type IdempotencyKey,
  type Membership,
  type MerchantWorkspaceId,
  type OrganizationId,
} from '../../packages/domain/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const merchantA: OrganizationId = internalId('draft-route-org-a', 'Organization');
const workspaceA: MerchantWorkspaceId = internalId('draft-route-ws-a', 'MerchantWorkspace');
const userId = internalId('draft-route-user-1', 'User');
const membershipId = internalId('draft-route-membership-1', 'Membership');
const conversationId: ConversationId = internalId('draft-route-conv-1', 'Conversation');
const key: IdempotencyKey = idempotencyKey('draft-route-idem-1');

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

const agencyOrgId: OrganizationId = internalId('draft-route-agency-a', 'Organization');
const agencyAssignmentId = agencyClientAssignmentId('draft-route-assignment-1');

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
        permission: permission('conversation:respond'),
        scope: { kind: 'MERCHANT_WORKSPACE', merchantWorkspaceId: workspaceA },
        sourceRef: 'claimed-cache-only',
      },
    ],
    assuranceLevel: 'STANDARD',
    channel: 'web',
    requestId: internalId('draft-route-request-1', 'Request'),
    runId: internalId('draft-route-run-1', 'Run'),
    locale: localeTag('tr-TR'),
    occurredAt: utcTimestamp('2026-10-21T12:00:00Z'),
    ...overrides,
  };
}

function existingConversationExecutor(insertRow?: Record<string, unknown>): MessageDraftQueryExecutor {
  return {
    query: (sql) => {
      if (sql.startsWith('SELECT 1')) return Promise.resolve({ rows: [{ '?column?': 1 }] });
      return Promise.resolve({
        rows: [
          insertRow ?? {
            draft_id: 'draft-1',
            proposed_text: 'Hello there',
            created_by: userId,
            created_at: '2026-10-21T12:00:00.000Z',
          },
        ],
      });
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

function baseRequest(overrides: Partial<MessageDraftHttpRequest> = {}): MessageDraftHttpRequest {
  return {
    conversationId,
    proposedText: 'Hello there',
    idempotencyKey: key,
    executionContext: baseExecutionContext(),
    membershipCandidates: membership(),
    agencyAssignmentCandidates: [],
    roleReader: roleReader(),
    store: createMessageDraftStore(existingConversationExecutor(), fakeLedger()),
    ...overrides,
  };
}

const cases: ReadonlyArray<{ readonly id: string; readonly run: () => Promise<void> }> = [
  {
    id: 'DRAFTROUTE-01-AUTHORIZED-DRAFT-CREATION-RETURNS-200-WITH-REAL-DATA',
    run: async () => {
      const result = await handleMessageDraftRequest(baseRequest());
      assert(result.httpStatus === 200, 'an authorized caller with conversation:respond must get a 200');
      assert(
        result.httpStatus === 200 && result.body.proposedText === 'Hello there' && result.body.replay === false,
        'the response must carry the real proposed text and a real (non-replay) creation flag',
      );
    },
  },
  {
    id: 'DRAFTROUTE-02-NO-ACTIVE-WORKSPACE-DENIES-403-BEFORE-ANY-STORE-CALL',
    run: async () => {
      let storeCalled = false;
      const store = createMessageDraftStore(
        {
          query: () => {
            storeCalled = true;
            return Promise.resolve({ rows: [] });
          },
        },
        fakeLedger(),
      );
      const result = await handleMessageDraftRequest(
        baseRequest({ executionContext: baseExecutionContext({ activeMerchantWorkspaceId: null }), store }),
      );
      assert(result.httpStatus === 403, 'a caller with no bound active workspace must be denied');
      assert(!storeCalled, 'the draft store must never be queried before tenancy/authorization is established');
    },
  },
  {
    id: 'DRAFTROUTE-03-MISSING-CONVERSATION-RESPOND-PERMISSION-DENIES-403-BEFORE-ANY-STORE-CALL',
    run: async () => {
      let storeCalled = false;
      const store = createMessageDraftStore(
        {
          query: () => {
            storeCalled = true;
            return Promise.resolve({ rows: [] });
          },
        },
        fakeLedger(),
      );
      // CLIENT_ANALYST has no conversation:respond grant in ROLE_PERMISSION_POLICY.
      const result = await handleMessageDraftRequest(baseRequest({ roleReader: roleReader(['CLIENT_ANALYST']), store }));
      assert(result.httpStatus === 403, 'a role lacking conversation:respond must be denied');
      assert(!storeCalled, 'authorization must fail closed before the draft store is ever queried');
    },
  },
  {
    id: 'DRAFTROUTE-04-MISSING-CONVERSATION-RETURNS-404',
    run: async () => {
      const store = createMessageDraftStore({ query: () => Promise.resolve({ rows: [] }) }, fakeLedger());
      const result = await handleMessageDraftRequest(baseRequest({ store }));
      assert(result.httpStatus === 404, 'drafting against a conversation that does not exist in this workspace must be a 404, never a fabricated success');
    },
  },
  {
    id: 'DRAFTROUTE-05-STORE-ERROR-RETURNS-RETRYABLE-500',
    run: async () => {
      const store = createMessageDraftStore({ query: () => Promise.reject(new Error('connection lost')) }, fakeLedger());
      const result = await handleMessageDraftRequest(baseRequest({ store }));
      assert(
        result.httpStatus === 500 && 'retryable' in result.body && result.body.retryable === true,
        'a real failure must surface as a retryable 500, never a false 200/404',
      );
    },
  },
  {
    id: 'DRAFTROUTE-06-LEDGER-REPLAY-RETURNS-200-WITH-REPLAY-TRUE-NEVER-REINSERTS',
    run: async () => {
      let insertCalled = false;
      const priorSnapshot = {
        draftId: internalId('draft-prior', 'MessageDraft'),
        proposedText: 'prior draft text',
        status: 'DRAFT',
        createdByUserId: userId,
        createdAt: '2026-10-20T10:00:00.000Z',
      };
      const store = createMessageDraftStore(
        {
          query: (sql) => {
            if (sql.startsWith('SELECT 1')) return Promise.resolve({ rows: [{ '?column?': 1 }] });
            insertCalled = true;
            return Promise.resolve({ rows: [] });
          },
        },
        fakeLedger({ tryGet: () => Promise.resolve({ status: 'FOUND', resultSnapshot: priorSnapshot }) }),
      );
      const result = await handleMessageDraftRequest(baseRequest({ store }));
      assert(result.httpStatus === 200, 'a replayed idempotency key must still return 200');
      assert(
        result.httpStatus === 200 && result.body.replay === true && result.body.proposedText === 'prior draft text',
        'a replay must surface the prior real outcome, flagged as a replay',
      );
      assert(!insertCalled, 'a replayed idempotency key must never reach the INSERT');
    },
  },
  {
    id: 'DRAFTROUTE-07-AGENCY-WITH-MODULE-RESTRICTION-EXCLUDING-CONVERSATION-DENIES-403-BEFORE-ANY-STORE-CALL',
    run: async () => {
      let storeCalled = false;
      const store = createMessageDraftStore(
        {
          query: () => {
            storeCalled = true;
            return Promise.resolve({ rows: [] });
          },
        },
        fakeLedger(),
      );
      const result = await handleMessageDraftRequest(
        baseRequest({
          executionContext: agencyExecutionContext(),
          membershipCandidates: agencyMembership(),
          agencyAssignmentCandidates: [agencyAssignment(['commerce'])],
          store,
        }),
      );
      assert(
        result.httpStatus === 403,
        "an agency whose current AgencyClientAssignment does not include the 'conversation' module must be denied, even with a role that grants conversation:respond",
      );
      assert(!storeCalled, 'the draft store must never be queried when the agency module allowlist excludes this operation');
    },
  },
];

async function main() {
  for (const testCase of cases) {
    await testCase.run();
    console.log(`PASS ${testCase.id}`);
  }
  console.log(`PASS ${cases.length}/${cases.length} message draft HTTP route scenarios`);
}

void main();
