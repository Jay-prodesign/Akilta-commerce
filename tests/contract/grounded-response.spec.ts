import {
  channelType,
  conversationStatus,
  idempotencyKey,
  internalId,
  localeTag,
  moduleKey,
  operationalStatus,
  utcTimestamp,
  type Conversation,
} from '../../packages/domain/src';
import type { ExecutionContext, ServerResolvedResourceContext } from '../../packages/authz/src';
import type { AiGatewayCandidate } from '../../packages/ai-gateway/src';
import {
  NOT_CLASSIFIED,
  rateCardVersion,
  reconciliationState,
  usageUnit,
  type AppendOnlyEventWriter,
  type AuditEvent,
  type EvaluationEvent,
  type IdempotencyRecord,
  type IdempotencyRegistry,
  type OperationalEvent,
  type UsageEvent,
} from '../../packages/events/src';
import type { FactCandidate, TruthAuthorityPolicy } from '../../packages/truth-policy/src';
import {
  orchestrateGroundedResponse,
  type GroundedResponseDependencies,
  type GroundedResponseInput,
} from '../../apps/api/src';

const now = utcTimestamp('2026-08-07T18:45:00Z');
const workspace = internalId('ws-orch-a', 'MerchantWorkspace');
const otherWorkspace = internalId('ws-orch-b', 'MerchantWorkspace');
const org = internalId('org-orch-a', 'Organization');
const user = internalId('user-orch-a', 'User');
const membership = internalId('membership-orch-a', 'Membership');
const conversationId = internalId('conv-orch-a', 'Conversation');
const integrationId = internalId('integration-orch-a', 'Integration');

const executionContext: ExecutionContext = {
  actorUserId: user,
  actorOrganizationId: org,
  actorOrganizationType: 'STANDALONE_MERCHANT',
  membershipId: membership,
  membershipStatus: operationalStatus('ACTIVE'),
  activeMerchantWorkspaceId: workspace,
  permissionSnapshotRef: 'perm-snapshot-1',
  permissionGrants: [{
    permission: 'conversation:respond',
    scope: { kind: 'MERCHANT_WORKSPACE', merchantWorkspaceId: workspace },
    sourceRef: 'role:client-support',
  }],
  assuranceLevel: 'STANDARD',
  channel: 'web',
  requestId: internalId('req-orch-1', 'Request'),
  runId: internalId('run-orch-1', 'Run'),
  locale: localeTag('tr-TR'),
  occurredAt: now,
};

const target: ServerResolvedResourceContext = {
  owningOrganizationId: org,
  merchantWorkspaceId: workspace,
  resourceType: 'conversation',
  resourceId: conversationId,
};

function conversation(state: Conversation['ownershipState'] = 'AI_ACTIVE'): Conversation {
  return {
    conversationId,
    merchantWorkspaceId: workspace,
    channel: channelType('WHATSAPP'),
    integrationId,
    channelThreadRef: 'thread:synth-1',
    ownershipState: state,
    ownershipEpoch: state === 'AI_ACTIVE' ? 3 : 4,
    status: conversationStatus('OPEN'),
    locale: localeTag('tr-TR'),
  };
}

function inbound(eventSuffix = '1', merchantWorkspaceId = workspace): OperationalEvent {
  return {
    eventId: internalId(`event-${eventSuffix}`, 'OperationalEvent'),
    merchantWorkspaceId,
    eventType: 'message.inbound',
    source: 'SYNTHETIC_WHATSAPP',
    sourceEventId: `provider-event-${eventSuffix}`,
    sourceTimestamp: now,
    observedAt: now,
    correlationId: internalId(`corr-${eventSuffix}`, 'Correlation'),
    idempotencyKey: idempotencyKey(`idem-${eventSuffix}`),
    safePayload: { textRef: `safe-message-${eventSuffix}` },
    processingState: 'RECEIVED',
  };
}

const policies: readonly TruthAuthorityPolicy[] = [
  { factClass: 'inventory', orderedAuthorityClasses: ['LIVE_PROVIDER', 'APPROVED_MERCHANT'] },
];
const knownFact: FactCandidate = {
  factClass: 'inventory',
  factKey: 'variant-1.availability',
  value: 'IN_STOCK',
  evidenceRef: 'inventory-observation-1',
  authorityClass: 'LIVE_PROVIDER',
  approvalState: 'APPROVED',
  freshnessState: 'FRESH',
};
const knownFacts: readonly FactCandidate[] = [knownFact];
const conflictingFacts: readonly FactCandidate[] = [
  knownFact,
  { ...knownFact, value: 'OUT_OF_STOCK', evidenceRef: 'inventory-observation-2' },
];
const goodClaim = { factClass: 'inventory', factKey: 'variant-1.availability', value: 'IN_STOCK' } as const;
const goodCandidate: AiGatewayCandidate = {
  candidateText: 'Bu ürün stokta görünüyor.',
  claimedFacts: [goodClaim],
  requestedTools: [],
  providerRef: 'SYNTHETIC_AI',
  modelRef: 'synthetic-model-v1',
};

class MemoryIdempotency implements IdempotencyRegistry {
  readonly records = new Map<string, IdempotencyRecord>();
  private key(ws: string, ns: string, key: string) { return `${ws}:${ns}:${key}`; }
  get(ws: IdempotencyRecord['merchantWorkspaceId'], ns: string, key: IdempotencyRecord['idempotencyKey']) {
    return Promise.resolve(this.records.get(this.key(ws, ns, key)) ?? null);
  }
  putIfAbsent(record: IdempotencyRecord) {
    const key = this.key(record.merchantWorkspaceId, record.namespace, record.idempotencyKey);
    if (this.records.has(key)) return Promise.resolve('EXISTS' as const);
    this.records.set(key, record);
    return Promise.resolve('INSERTED' as const);
  }
}

class MemoryWriter<T> implements AppendOnlyEventWriter<T> {
  readonly events: T[] = [];
  append(event: T) { this.events.push(event); return Promise.resolve(); }
}

function makeDeps(options: {
  readonly facts?: readonly FactCandidate[];
  readonly candidate?: AiGatewayCandidate;
} = {}) {
  let sequence = 0;
  let aiCalls = 0;
  let evidenceCalls = 0;
  const auditWriter = new MemoryWriter<AuditEvent>();
  const evaluationWriter = new MemoryWriter<EvaluationEvent>();
  const usageWriter = new MemoryWriter<UsageEvent>();
  const idempotencyRegistry = new MemoryIdempotency();
  const deps: GroundedResponseDependencies = {
    evidenceLookup: {
      collect() {
        evidenceCalls += 1;
        return Promise.resolve(options.facts ?? knownFacts);
      },
    },
    aiGateway: {
      generateResponse() {
        aiCalls += 1;
        return Promise.resolve(options.candidate ?? goodCandidate);
      },
    },
    idempotencyRegistry,
    auditWriter,
    evaluationWriter,
    usageWriter,
    eventFactory: {
      audit(input) {
        sequence += 1;
        return {
          auditEventId: internalId(`audit-${sequence}`, 'AuditEvent'),
          actorUserId: user,
          actorOrganizationId: org,
          merchantWorkspaceId: workspace,
          resourceType: 'conversation',
          resourceId: conversationId,
          action: 'grounded_response',
          decision: input.decision,
          ...(input.matchedPermissionOrPolicyRef !== undefined
            ? { matchedPermissionOrPolicyRef: input.matchedPermissionOrPolicyRef }
            : {}),
          requestId: executionContext.requestId,
          runId: executionContext.runId,
          correlationId: internalId('corr-factory', 'Correlation'),
          result: input.result,
          occurredAt: now,
        };
      },
      evaluation(input) {
        sequence += 1;
        return {
          evaluationEventId: internalId(`eval-${sequence}`, 'EvaluationEvent'),
          merchantWorkspaceId: workspace,
          runId: executionContext.runId,
          stage: input.stage,
          ...(input.modelRef !== undefined ? { modelRef: input.modelRef } : {}),
          ...(input.errorCode !== undefined ? { errorCode: input.errorCode } : {}),
          trainingEligibility: NOT_CLASSIFIED,
          privacyClassification: 'SYNTHETIC_NON_PII',
          redactionState: 'SAFE',
          safePayload: input.safePayload,
          occurredAt: now,
        };
      },
      usage(input) {
        sequence += 1;
        return {
          usageEventId: internalId(`usage-${sequence}`, 'UsageEvent'),
          merchantWorkspaceId: workspace,
          module: 'support',
          runId: executionContext.runId,
          correlationId: internalId('corr-usage', 'Correlation'),
          logicalOperationRef: input.logicalOperationRef,
          providerType: input.providerType,
          providerOperation: input.providerOperation,
          quantity: 1n,
          unit: usageUnit('AI_CALL'),
          rateCardVersion: rateCardVersion('UNPRICED_STAGING'),
          estimatedFlag: true,
          reconciliationState: reconciliationState('PENDING'),
          ...(input.providerUsageRef !== undefined ? { providerUsageRef: input.providerUsageRef } : {}),
          occurredAt: now,
        };
      },
    },
  };
  return {
    deps,
    auditWriter,
    evaluationWriter,
    usageWriter,
    idempotencyRegistry,
    getAiCalls: () => aiCalls,
    getEvidenceCalls: () => evidenceCalls,
  };
}

function baseInput(event = inbound('1')): GroundedResponseInput {
  return {
    inboundEvent: event,
    executionContext,
    target,
    requiredPermission: 'conversation:respond',
    module: moduleKey('support'),
    conversation: conversation(),
    intent: 'stock_question',
    requestedFacts: [{ factClass: 'inventory', factKey: 'variant-1.availability' }],
    truthPolicies: policies,
    approvedFactSetId: internalId(`facts-${event.eventId}`, 'ApprovedFactSet'),
    safeConversationContext: { messages: [{ role: 'customer', text: 'Bu ürün stokta mı?' }] },
    responsePolicyRef: 'support-v1',
    allowedAiTools: [],
  };
}

async function run() {
  const results: { id: string; actual: unknown; expected: unknown }[] = [];

  const ok = makeDeps();
  const okResult = await orchestrateGroundedResponse(baseInput(inbound('ok')), ok.deps);
  results.push({ id: 'VS-01/02/03-GROUNDED-READY', actual: okResult.outcome, expected: 'SEND_CANDIDATE_READY' });
  results.push({ id: 'VS-09-USAGE-ONE-AI-OP', actual: ok.usageWriter.events.length, expected: 1 });
  results.push({ id: 'VS-10-EVAL-LINEAGE', actual: ok.evaluationWriter.events.map((e) => e.stage).join('>'), expected: 'INPUT>RETRIEVAL>FIRST_OUTPUT>CHECK>FINAL_OUTPUT' });

  const duplicate = await orchestrateGroundedResponse(baseInput(inbound('ok')), ok.deps);
  results.push({ id: 'VS-08-DUPLICATE-NO-SECOND-SEND-CANDIDATE', actual: duplicate.outcome, expected: 'DUPLICATE' });
  results.push({ id: 'VS-08-DUPLICATE-NO-SECOND-AI-CALL', actual: ok.getAiCalls(), expected: 1 });

  const deniedDeps = makeDeps();
  const deniedContext: ExecutionContext = { ...executionContext, permissionGrants: [] };
  const denied = await orchestrateGroundedResponse({ ...baseInput(inbound('deny')), executionContext: deniedContext }, deniedDeps.deps);
  results.push({ id: 'TM-01-AUTHZ-DENY-BEFORE-EVIDENCE', actual: `${denied.outcome}:${deniedDeps.getEvidenceCalls()}:${deniedDeps.getAiCalls()}`, expected: 'DENIED:0:0' });

  const unknownDeps = makeDeps({ facts: [] });
  const unknown = await orchestrateGroundedResponse(baseInput(inbound('unknown')), unknownDeps.deps);
  results.push({ id: 'VS-03-UNKNOWN-HANDOFF-NO-AI', actual: `${unknown.outcome}:${'code' in unknown ? unknown.code : ''}:${unknownDeps.getAiCalls()}`, expected: 'HANDOFF_REQUIRED:TRUTH_MISSING:0' });

  const conflictDeps = makeDeps({ facts: conflictingFacts });
  const conflict = await orchestrateGroundedResponse(baseInput(inbound('conflict')), conflictDeps.deps);
  results.push({ id: 'VS-03-CONFLICT-HANDOFF', actual: `${conflict.outcome}:${'code' in conflict ? conflict.code : ''}`, expected: 'HANDOFF_REQUIRED:TRUTH_CONFLICT' });

  const badClaimDeps = makeDeps({ candidate: { ...goodCandidate, claimedFacts: [{ ...goodClaim, value: 'OUT_OF_STOCK' }] } });
  const badClaim = await orchestrateGroundedResponse(baseInput(inbound('badclaim')), badClaimDeps.deps);
  results.push({ id: 'VS-07-UNGROUNDED-CANDIDATE-FAILS', actual: `${badClaim.outcome}:${'code' in badClaim ? badClaim.code : ''}`, expected: 'HANDOFF_REQUIRED:AI_OUTPUT_GROUNDEDNESS_FAIL' });

  const badToolDeps = makeDeps({ candidate: { ...goodCandidate, requestedTools: [{ toolName: 'switch_tenant', argumentsRef: 'malicious' }] } });
  const badTool = await orchestrateGroundedResponse(baseInput(inbound('badtool')), badToolDeps.deps);
  results.push({ id: 'TM-03/04-TOOL-ESCALATION-FAILS', actual: `${badTool.outcome}:${'code' in badTool ? badTool.code : ''}`, expected: 'HANDOFF_REQUIRED:AI_OUTPUT_POLICY_FAIL' });

  const humanDeps = makeDeps();
  const human = await orchestrateGroundedResponse({ ...baseInput(inbound('human')), conversation: conversation('HUMAN_ACTIVE') }, humanDeps.deps);
  results.push({ id: 'VS-05-HUMAN-ACTIVE-SUGGEST-ONLY', actual: human.outcome, expected: 'SUGGEST_ONLY' });

  const crossDeps = makeDeps();
  const cross = await orchestrateGroundedResponse({ ...baseInput(inbound('cross', otherWorkspace)) }, crossDeps.deps);
  results.push({ id: 'TM-01-CROSS-WORKSPACE-FAIL-CLOSED', actual: cross.outcome, expected: 'DENIED' });

  const failed = results.filter((x) => x.actual !== x.expected);
  if (failed.length) {
    for (const failure of failed) console.error('FAIL', failure);
    throw new Error(`${failed.length}/${results.length} grounded-response scenarios failed`);
  }
  console.log(`PASS ${results.length}/${results.length}`);
  for (const result of results) console.log(`PASS ${result.id}`);
}

void run();
