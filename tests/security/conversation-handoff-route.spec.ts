import {
  handleConversationOwnershipTransitionRequest,
  handleConversationOwnershipReadRequest,
  type ConversationOwnershipHttpRequest,
  type ConversationOwnershipReadHttpRequest,
} from '../../apps/api/src/conversation-handoff-route';
import {
  createConversationOwnershipStore,
  type ConversationOwnershipQueryExecutor,
  type ConversationOwnershipStore,
} from '../../apps/api/src/conversation-ownership-store';
import {
  type IdempotencyLedgerReadOutcome,
  type IdempotencyLedgerStore,
  type IdempotencyLedgerWriteOutcome,
} from '../../apps/api/src/idempotency-ledger-store';
import {
  conversationOwnershipIdempotencyKey,
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
  type ConversationId,
  type Membership,
  type MerchantWorkspaceId,
  type OrganizationId,
} from '../../packages/domain/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const merchantA: OrganizationId = internalId('route-org-a', 'Organization');
const merchantB: OrganizationId = internalId('route-org-b', 'Organization');
const workspaceA: MerchantWorkspaceId = internalId('route-ws-a', 'MerchantWorkspace');
const userId = internalId('route-user-1', 'User');
const membershipId = internalId('route-membership-1', 'Membership');
const conversationId: ConversationId = internalId('route-conv-1', 'Conversation');

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

const agencyOrgId: OrganizationId = internalId('route-agency-a', 'Organization');
const agencyAssignmentId = agencyClientAssignmentId('route-assignment-1');

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
        permission: permission('conversation:assign'),
        scope: { kind: 'MERCHANT_WORKSPACE', merchantWorkspaceId: workspaceA },
        sourceRef: 'claimed-cache-only',
      },
    ],
    assuranceLevel: 'STANDARD',
    channel: 'web',
    requestId: internalId('route-request-1', 'Request'),
    runId: internalId('route-run-1', 'Run'),
    locale: localeTag('tr-TR'),
    occurredAt: utcTimestamp('2026-10-16T12:00:00Z'),
    ...overrides,
  };
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

function fakeLedger(overrides: Partial<IdempotencyLedgerStore> = {}): IdempotencyLedgerStore {
  return {
    tryGet: (): Promise<IdempotencyLedgerReadOutcome> => Promise.resolve({ status: 'NOT_FOUND' }),
    record: (): Promise<IdempotencyLedgerWriteOutcome> => Promise.resolve({ status: 'RECORDED' }),
    ...overrides,
  };
}

function baseRequest(overrides: Partial<ConversationOwnershipHttpRequest> = {}): ConversationOwnershipHttpRequest {
  return {
    trigger: 'HUMAN_TAKEOVER',
    conversationId,
    expectedEpoch: 0,
    idempotencyKey: conversationOwnershipIdempotencyKey('route-op-1'),
    actorRef: 'system:test-actor',
    executionContext: baseExecutionContext(),
    membershipCandidates: membership(),
    agencyAssignmentCandidates: [],
    roleReader: roleReader(),
    store: createConversationOwnershipStore(fakeExecutor({ ownership_state: 'AI_ACTIVE', ownership_epoch: 0 }), fakeLedger()),
    ...overrides,
  };
}

function baseReadRequest(overrides: Partial<ConversationOwnershipReadHttpRequest> = {}): ConversationOwnershipReadHttpRequest {
  return {
    conversationId,
    executionContext: baseExecutionContext(),
    membershipCandidates: membership(),
    agencyAssignmentCandidates: [],
    roleReader: roleReader(),
    store: createConversationOwnershipStore(fakeExecutor({ ownership_state: 'HUMAN_ACTIVE', ownership_epoch: 3 }), fakeLedger()),
    ...overrides,
  };
}

const cases: ReadonlyArray<{ readonly id: string; readonly run: () => Promise<void> }> = [
  {
    id: 'ROUTE-01-AUTHORIZED-HUMAN-TAKEOVER-APPLIES-AND-RETURNS-200',
    run: async () => {
      const result = await handleConversationOwnershipTransitionRequest(baseRequest());
      assert(result.httpStatus === 200, 'an authorized human-takeover must return HTTP 200');
      assert(
        result.httpStatus === 200 && result.body.ownershipState === 'HUMAN_ACTIVE' && result.body.epoch === 1 && !result.body.replay,
        'a successful transition must report the new state/epoch and replay:false',
      );
    },
  },
  {
    id: 'ROUTE-02-NO-ACTIVE-WORKSPACE-DENIES-403-BEFORE-ANY-STORE-CALL',
    run: async () => {
      let storeCalled = false;
      const store = createConversationOwnershipStore(
        {
          query: () => {
            storeCalled = true;
            return Promise.resolve({ rows: [] });
          },
        },
        fakeLedger(),
      );
      const result = await handleConversationOwnershipTransitionRequest(
        baseRequest({ executionContext: baseExecutionContext({ activeMerchantWorkspaceId: null }), store }),
      );
      assert(result.httpStatus === 403, 'a caller with no bound active workspace must be denied, never routed to the store');
      assert(!storeCalled, 'the store must never be queried before tenancy/authorization is established');
    },
  },
  {
    id: 'ROUTE-03-MISSING-PERMISSION-DENIES-403-BEFORE-ANY-STORE-CALL',
    run: async () => {
      let storeCalled = false;
      const store = createConversationOwnershipStore(
        {
          query: () => {
            storeCalled = true;
            return Promise.resolve({ rows: [] });
          },
        },
        fakeLedger(),
      );
      const result = await handleConversationOwnershipTransitionRequest(
        baseRequest({ roleReader: roleReader(['CLIENT_ANALYST']), store }),
      );
      assert(result.httpStatus === 403, 'a role lacking conversation:assign must be denied');
      assert(!storeCalled, 'authorization must fail closed before the ownership store is ever queried');
    },
  },
  {
    id: 'ROUTE-04-CROSS-TENANT-TARGET-DENIES-403',
    run: async () => {
      const result = await handleConversationOwnershipTransitionRequest(
        baseRequest({ executionContext: baseExecutionContext({ actorOrganizationId: merchantB }) }),
      );
      assert(result.httpStatus === 403, 'a standalone actor whose organization does not own the target workspace org must be denied');
    },
  },
  {
    id: 'ROUTE-05-NO-EXISTING-CONVERSATION-RETURNS-404',
    run: async () => {
      const store = createConversationOwnershipStore(fakeExecutor(null), fakeLedger());
      const result = await handleConversationOwnershipTransitionRequest(baseRequest({ store }));
      assert(result.httpStatus === 404, 'a conversation row that does not exist for this workspace must return 404, not 500');
    },
  },
  {
    id: 'ROUTE-06-STALE-EXPECTED-EPOCH-RETURNS-409-OWNERSHIP-CONFLICT',
    run: async () => {
      const store = createConversationOwnershipStore(fakeExecutor({ ownership_state: 'AI_ACTIVE', ownership_epoch: 5 }), fakeLedger());
      const result = await handleConversationOwnershipTransitionRequest(baseRequest({ store, expectedEpoch: 0 }));
      assert(
        result.httpStatus === 409 && 'code' in result.body && result.body.code === 'OWNERSHIP_CONFLICT',
        'a stale expected epoch must surface as a 409 OWNERSHIP_CONFLICT, never a silent overwrite',
      );
    },
  },
  {
    id: 'ROUTE-07-TERMINAL-STATE-TRANSITION-RETURNS-409-INVALID-TRANSITION',
    run: async () => {
      const store = createConversationOwnershipStore(fakeExecutor({ ownership_state: 'CLOSED', ownership_epoch: 3 }), fakeLedger());
      const result = await handleConversationOwnershipTransitionRequest(baseRequest({ store, expectedEpoch: 3 }));
      assert(
        result.httpStatus === 409 && 'code' in result.body && result.body.code === 'INVALID_TRANSITION' && result.body.reason === 'TERMINAL_STATE',
        'CLOSED must never implicitly reactivate; the route must surface the exact TERMINAL_STATE reason',
      );
    },
  },
  {
    id: 'ROUTE-08-TRIGGER-NOT-ALLOWED-FROM-STATE-RETURNS-409-INVALID-TRANSITION',
    run: async () => {
      // AI_SUGGEST_ONLY has no HUMAN_TAKEOVER edge in the canonical state machine.
      const store = createConversationOwnershipStore(fakeExecutor({ ownership_state: 'AI_SUGGEST_ONLY', ownership_epoch: 2 }), fakeLedger());
      const result = await handleConversationOwnershipTransitionRequest(baseRequest({ store, expectedEpoch: 2 }));
      assert(
        result.httpStatus === 409 && 'code' in result.body && result.body.code === 'INVALID_TRANSITION' && result.body.reason === 'TRIGGER_NOT_ALLOWED_FROM_STATE',
        'a trigger undefined for the current state must be rejected with the exact reason, never silently permitted',
      );
    },
  },
  {
    id: 'ROUTE-09-IDEMPOTENT-RETRY-REPLAYS-WITHOUT-RE-APPLYING',
    run: async () => {
      const key = conversationOwnershipIdempotencyKey('route-retry-1');
      const ledger = fakeLedger({
        tryGet: () => Promise.resolve({ status: 'FOUND', resultSnapshot: { state: 'HUMAN_ACTIVE', epoch: 1 } }),
      });
      let writeAttempted = false;
      const store = createConversationOwnershipStore(
        {
          query: (sql) => {
            if (sql.startsWith('SELECT')) return Promise.resolve({ rows: [{ ownership_state: 'CLOSED', ownership_epoch: 9 }] });
            writeAttempted = true;
            return Promise.resolve({ rows: [] });
          },
        },
        ledger,
      );
      const result = await handleConversationOwnershipTransitionRequest(
        baseRequest({ store, idempotencyKey: key, expectedEpoch: 0 }),
      );
      assert(
        result.httpStatus === 200 && result.body.replay === true && result.body.epoch === 1 && result.body.ownershipState === 'HUMAN_ACTIVE',
        'a retried request with a previously-applied idempotency key must replay the original outcome as a 200, even against a drifted/terminal row',
      );
      assert(!writeAttempted, 'a replayed idempotent retry must never attempt a database write');
    },
  },
  {
    id: 'ROUTE-10-RETURN-TO-AI-TRIGGER-USES-REQUEST-RETURN-TO-AI-NOT-HUMAN-TAKEOVER',
    run: async () => {
      const store = createConversationOwnershipStore(fakeExecutor({ ownership_state: 'HUMAN_ACTIVE', ownership_epoch: 1 }), fakeLedger());
      const result = await handleConversationOwnershipTransitionRequest(
        baseRequest({ trigger: 'REQUEST_RETURN_TO_AI', store, expectedEpoch: 1 }),
      );
      assert(
        result.httpStatus === 200 && result.body.ownershipState === 'RETURN_TO_AI_PENDING',
        'the return-to-ai operation must drive the REQUEST_RETURN_TO_AI trigger, landing in RETURN_TO_AI_PENDING, not a human-takeover transition',
      );
    },
  },
  {
    id: 'ROUTE-11-AUDIT-WRITE-FAILURE-STILL-REPORTS-THE-REAL-APPLIED-STATE-AS-200',
    run: async () => {
      let selectCount = 0;
      const store = createConversationOwnershipStore(
        {
          query: (sql) => {
            if (sql.startsWith('SELECT')) {
              selectCount += 1;
              return Promise.resolve({ rows: [{ ownership_state: 'AI_ACTIVE', ownership_epoch: 0 }] });
            }
            if (sql.includes('INSERT INTO conversation_ownership_events')) {
              throw new Error('simulated audit insert failure');
            }
            return Promise.resolve({ rows: [{ ownership_state: 'HUMAN_ACTIVE', ownership_epoch: 1 }] });
          },
        },
        fakeLedger(),
      );
      const result = await handleConversationOwnershipTransitionRequest(baseRequest({ store }));
      assert(selectCount === 1, 'sanity: exactly one read should have occurred');
      assert(
        result.httpStatus === 200 && result.body.auditWriteFailed === true && result.body.ledgerWriteFailed === false && result.body.epoch === 1,
        'an audit-write failure must never be reported as a 500 — the authoritative CAS update already succeeded and must be surfaced as a real success carrying an explicit warning',
      );
    },
  },
  {
    id: 'ROUTE-11B-LEDGER-WRITE-FAILURE-STILL-REPORTS-THE-REAL-APPLIED-STATE-AS-200',
    run: async () => {
      const store = createConversationOwnershipStore(
        fakeExecutor({ ownership_state: 'AI_ACTIVE', ownership_epoch: 0 }),
        fakeLedger({ record: () => Promise.resolve({ status: 'STORE_ERROR' }) }),
      );
      const result = await handleConversationOwnershipTransitionRequest(baseRequest({ store }));
      assert(
        result.httpStatus === 200 && result.body.ledgerWriteFailed === true && result.body.auditWriteFailed === false && result.body.replay === false && result.body.epoch === 1,
        'a ledger-write failure must never be reported as a 500 — the authoritative CAS update already succeeded and must be surfaced as a real success carrying an explicit warning, distinct from an audit-write warning',
      );
    },
  },
  {
    id: 'ROUTE-11C-BOTH-LEDGER-AND-AUDIT-WRITE-FAILURES-ARE-BOTH-REPORTED-OVER-HTTP-NEITHER-SILENTLY-DROPPED',
    run: async () => {
      const store = createConversationOwnershipStore(
        {
          query: (sql) => {
            if (sql.startsWith('SELECT')) return Promise.resolve({ rows: [{ ownership_state: 'AI_ACTIVE', ownership_epoch: 0 }] });
            if (sql.includes('INSERT INTO conversation_ownership_events')) throw new Error('simulated audit insert failure');
            return Promise.resolve({ rows: [{ ownership_state: 'HUMAN_ACTIVE', ownership_epoch: 1 }] });
          },
        },
        fakeLedger({ record: () => Promise.resolve({ status: 'STORE_ERROR' }) }),
      );
      const result = await handleConversationOwnershipTransitionRequest(baseRequest({ store }));
      assert(
        result.httpStatus === 200 && result.body.auditWriteFailed === true && result.body.ledgerWriteFailed === true && result.body.epoch === 1,
        'when the ledger write AND the audit insert both fail in the same request, the HTTP response must report both auditWriteFailed:true and ledgerWriteFailed:true — neither flag may silently overwrite the other',
      );
    },
  },
  {
    id: 'ROUTE-12-AUTHORIZED-READ-RETURNS-200-WITH-STATE-AND-EPOCH',
    run: async () => {
      const result = await handleConversationOwnershipReadRequest(baseReadRequest());
      assert(
        result.httpStatus === 200 && result.body.ownershipState === 'HUMAN_ACTIVE' && result.body.epoch === 3,
        'an authorized read must return the real current state/epoch so a caller can discover the CAS precondition for a later handoff/return-to-ai call',
      );
    },
  },
  {
    id: 'ROUTE-13-READ-MISSING-CONVERSATION-READ-PERMISSION-DENIES-403-BEFORE-ANY-STORE-CALL',
    run: async () => {
      let storeCalled = false;
      const store: ConversationOwnershipStore = {
        applyTransition: () => Promise.reject(new Error('must not be called')),
        getCurrent: () => {
          storeCalled = true;
          return Promise.resolve({ status: 'NOT_FOUND' });
        },
      };
      const result = await handleConversationOwnershipReadRequest(
        baseReadRequest({ roleReader: roleReader(['CLIENT_ANALYST']), store }),
      );
      assert(result.httpStatus === 403, 'a role lacking conversation:read must be denied read access');
      assert(!storeCalled, 'authorization must fail closed before the ownership store is ever queried for a read');
    },
  },
  {
    id: 'ROUTE-14-READ-NO-EXISTING-CONVERSATION-RETURNS-404',
    run: async () => {
      const store = createConversationOwnershipStore(fakeExecutor(null), fakeLedger());
      const result = await handleConversationOwnershipReadRequest(baseReadRequest({ store }));
      assert(result.httpStatus === 404, 'reading a conversation absent from this workspace must return 404, not 500 or an empty 200');
    },
  },
  {
    id: 'ROUTE-15-READ-STORE-ERROR-RETURNS-500-RETRYABLE',
    run: async () => {
      const store: ConversationOwnershipStore = {
        applyTransition: () => Promise.reject(new Error('must not be called')),
        getCurrent: () => Promise.resolve({ status: 'STORE_ERROR' }),
      };
      const result = await handleConversationOwnershipReadRequest(baseReadRequest({ store }));
      assert(
        result.httpStatus === 500 && 'retryable' in result.body && result.body.retryable === true,
        'a real read failure must surface as a retryable 500, never a false 404/200',
      );
    },
  },
  {
    id: 'ROUTE-16-AGENCY-WITH-MODULE-RESTRICTION-EXCLUDING-CONVERSATION-DENIES-TRANSITION-403',
    run: async () => {
      let storeCalled = false;
      const store = createConversationOwnershipStore(
        {
          query: () => {
            storeCalled = true;
            return Promise.resolve({ rows: [] });
          },
        },
        fakeLedger(),
      );
      const result = await handleConversationOwnershipTransitionRequest(
        baseRequest({
          executionContext: agencyExecutionContext(),
          membershipCandidates: agencyMembership(),
          agencyAssignmentCandidates: [agencyAssignment(['commerce'])],
          store,
        }),
      );
      assert(
        result.httpStatus === 403,
        "an agency whose current AgencyClientAssignment does not include the 'conversation' module must be denied a handoff, even with a role that grants conversation:assign",
      );
      assert(!storeCalled, 'the ownership store must never be queried when the agency module allowlist excludes this operation');
    },
  },
  {
    id: 'ROUTE-17-AGENCY-WITH-MODULE-RESTRICTION-EXCLUDING-CONVERSATION-DENIES-READ-403',
    run: async () => {
      let storeCalled = false;
      const store: ConversationOwnershipStore = {
        applyTransition: () => Promise.reject(new Error('must not be called')),
        getCurrent: () => {
          storeCalled = true;
          return Promise.resolve({ status: 'NOT_FOUND' });
        },
      };
      const result = await handleConversationOwnershipReadRequest(
        baseReadRequest({
          executionContext: agencyExecutionContext(),
          membershipCandidates: agencyMembership(),
          agencyAssignmentCandidates: [agencyAssignment(['commerce'])],
          store,
        }),
      );
      assert(
        result.httpStatus === 403,
        "an agency whose current AgencyClientAssignment does not include the 'conversation' module must be denied even a read, even with a role that grants conversation:read",
      );
      assert(!storeCalled, 'the ownership store must never be queried for a read when the agency module allowlist excludes this operation');
    },
  },
];

async function main() {
  for (const testCase of cases) {
    await testCase.run();
    console.log(`PASS ${testCase.id}`);
  }
  console.log(`PASS ${cases.length}/${cases.length} conversation handoff/return-to-ai HTTP route scenarios`);
}

void main();
