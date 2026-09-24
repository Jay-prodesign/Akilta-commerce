import {
  nextModelAttempt,
  routeModelProfile,
  validateModelFallback,
  type ModelAuthorityInvariant,
  type ModelProfile,
} from '../../packages/ai-gateway/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const highVolumePending: ModelProfile = {
  profileId: 'high-volume-pending',
  taskClass: 'T2_CUSTOMER_RESPONSE',
  minimumRequiredCapabilities: ['TEXT', 'MULTILINGUAL'],
  latencyClass: 'FAST',
  costClass: 'LOW',
  evaluationStatus: 'PENDING',
  allowedModels: [
    { providerRef: 'synthetic-provider', modelRef: 'cheap-pending', capabilities: ['TEXT', 'MULTILINGUAL'], availability: 'AVAILABLE' },
  ],
};
const balancedPass: ModelProfile = {
  profileId: 'balanced-pass',
  taskClass: 'T2_CUSTOMER_RESPONSE',
  minimumRequiredCapabilities: ['TEXT', 'MULTILINGUAL'],
  latencyClass: 'BALANCED',
  costClass: 'MEDIUM',
  evaluationStatus: 'PASS',
  evaluationRef: 'eval:balanced:1',
  fallbackProfileId: 'high-capability-pass',
  allowedModels: [
    { providerRef: 'synthetic-provider', modelRef: 'balanced-fixture', capabilities: ['TEXT', 'MULTILINGUAL', 'STRUCTURED_OUTPUT'], availability: 'AVAILABLE' },
  ],
};
const highCapabilityPass: ModelProfile = {
  profileId: 'high-capability-pass',
  taskClass: 'T2_CUSTOMER_RESPONSE',
  minimumRequiredCapabilities: ['TEXT', 'MULTILINGUAL'],
  latencyClass: 'SLOW_ALLOWED',
  costClass: 'HIGH',
  evaluationStatus: 'PASS',
  evaluationRef: 'eval:high:1',
  allowedModels: [
    { providerRef: 'synthetic-provider-2', modelRef: 'high-fixture', capabilities: ['TEXT', 'MULTILINGUAL', 'STRUCTURED_OUTPUT', 'HIGH_REASONING'], availability: 'AVAILABLE' },
  ],
};
const fallbackPending: ModelProfile = { ...highCapabilityPass, profileId: 'fallback-pending', evaluationStatus: 'PENDING' };

const invariant: ModelAuthorityInvariant = {
  approvedFactSetRef: 'facts:1',
  unknownFactRefs: ['stock:variant-1'],
  conflictFactRefs: [],
  allowedToolNames: ['get_product', 'create_handoff'],
  disclosureBoundaryRef: 'disclosure:cv1',
  authorizationBoundaryRef: 'authz:run-1',
  actionAuthority: 'NONE',
};

const cases: Array<{ id: string; run: () => void }> = [
  {
    id: 'AI-10-CHEAPER-PENDING-PROFILE-NOT-PROMOTED',
    run: () => {
      const decision = routeModelProfile(
        { taskClass: 'T2_CUSTOMER_RESPONSE', requiredCapabilities: ['TEXT', 'MULTILINGUAL'] },
        [highVolumePending, balancedPass, highCapabilityPass],
      );
      assert(decision.status === 'ROUTED' && decision.profile.profileId === 'balanced-pass', 'cheapest eval-PASS profile should win; pending cheaper cannot');
    },
  },
  {
    id: 'AI-ROUTING-UNAVAILABLE-MODEL-SKIPPED',
    run: () => {
      const unavailable = { ...balancedPass, allowedModels: [{ ...balancedPass.allowedModels[0]!, availability: 'UNAVAILABLE' as const }] };
      const decision = routeModelProfile(
        { taskClass: 'T2_CUSTOMER_RESPONSE', requiredCapabilities: ['TEXT', 'MULTILINGUAL'] },
        [unavailable, highCapabilityPass],
      );
      assert(decision.status === 'ROUTED' && decision.profile.profileId === 'high-capability-pass', 'unavailable model should fall through');
    },
  },
  {
    id: 'AI-07-FALLBACK-PRESERVES-AUTHORITY-UNKNOWN',
    run: () => {
      const result = validateModelFallback({ primaryProfile: balancedPass, fallbackProfile: highCapabilityPass, before: invariant, after: { ...invariant } });
      assert(result.status === 'ALLOW', 'same authority contract fallback should allow');
    },
  },
  {
    id: 'AI-07-FALLBACK-CANNOT-TURN-UNKNOWN-KNOWN',
    run: () => {
      const result = validateModelFallback({ primaryProfile: balancedPass, fallbackProfile: highCapabilityPass, before: invariant, after: { ...invariant, unknownFactRefs: [] } });
      assert(result.status === 'DENY' && result.reason === 'UNKNOWN_STATE_CHANGED', 'fallback cannot erase unknown');
    },
  },
  {
    id: 'AI-07-FALLBACK-CANNOT-ADD-TOOLS',
    run: () => {
      const result = validateModelFallback({ primaryProfile: balancedPass, fallbackProfile: highCapabilityPass, before: invariant, after: { ...invariant, allowedToolNames: [...invariant.allowedToolNames, 'switch_tenant'] } });
      assert(result.status === 'DENY' && result.reason === 'TOOLS_CHANGED', 'fallback cannot add tool authority');
    },
  },
  {
    id: 'AI-07-FALLBACK-CANNOT-CHANGE-DISCLOSURE',
    run: () => {
      const result = validateModelFallback({ primaryProfile: balancedPass, fallbackProfile: highCapabilityPass, before: invariant, after: { ...invariant, disclosureBoundaryRef: 'disclosure:cv3' } });
      assert(result.status === 'DENY' && result.reason === 'DISCLOSURE_BOUNDARY_CHANGED', 'fallback cannot widen disclosure');
    },
  },
  {
    id: 'AI-09-FALLBACK-EVAL-MUST-PASS',
    run: () => {
      const result = validateModelFallback({ primaryProfile: balancedPass, fallbackProfile: fallbackPending, before: invariant, after: invariant });
      assert(result.status === 'DENY' && result.reason === 'FALLBACK_EVAL_NOT_PASS', 'model change requires eval PASS');
    },
  },
  {
    id: 'AI-08-INVALID-STRUCTURED-OUTPUT-ONE-BOUNDED-RETRY',
    run: () => {
      assert(nextModelAttempt({ failure: 'STRUCTURED_OUTPUT_INVALID', attemptsSoFar: 0 }) === 'RETRY_SAME_CONTRACT', 'first format repair may retry');
      assert(nextModelAttempt({ failure: 'STRUCTURED_OUTPUT_INVALID', attemptsSoFar: 1 }) === 'FAIL_CLOSED_HANDOFF', 'second failure must stop');
    },
  },
  {
    id: 'AI-TRUTH-FAIL-NEVER-RETRY-FOR-BYPASS',
    run: () => {
      assert(nextModelAttempt({ failure: 'TRUTH_CHECK_FAIL', attemptsSoFar: 0 }) === 'FAIL_CLOSED_HANDOFF', 'truth fail should not prompt-loop');
    },
  },
  {
    id: 'AI-AUTHZ-FAIL-NEVER-RETRY-FOR-BYPASS',
    run: () => {
      assert(nextModelAttempt({ failure: 'AUTHZ_POLICY_FAIL', attemptsSoFar: 0 }) === 'FAIL_CLOSED_HANDOFF', 'authz fail should not prompt-loop');
    },
  },
];

for (const testCase of cases) {
  testCase.run();
  console.log(`PASS ${testCase.id}`);
}
console.log(`PASS ${cases.length}/${cases.length} AI routing scenarios`);
