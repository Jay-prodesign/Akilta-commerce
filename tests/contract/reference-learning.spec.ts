import { reviewReferencePattern, type ReferenceReviewInput } from '../../packages/domain/src/reference-learning';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const reusable = {
  projectSpecific: false,
  brandSpecific: false,
  shopifySpecific: false,
  commercePlatformSpecific: false,
  platformIndependent: true,
  reusableAiCommerceCapability: true,
  reusableEvaluationTestCase: true,
  reusableOperationalPattern: true,
  reusableSafetyGovernancePattern: true,
} as const;

const base: ReferenceReviewInput = {
  patternId: 'pre-read-post-read',
  sourceMode: 'READ_ONLY',
  classification: reusable,
  evidence: [
    { sourceProject: 'BPC', sourceArtifactRef: 'bpc:artifact:1', sourceVersionRef: 'v1', validationState: 'PASS', measuredOutcomeRef: 'metric:bpc:1' },
  ],
  hiddenDependencyReview: 'PASS',
  rawCustomerPiiCopied: false,
  secretCopied: false,
  sourceMutationRequiredForLearning: false,
  openBlockers: [],
};

const tests: Array<readonly [string, () => void]> = [
  ['single-project success cannot productize', () => {
    const result = reviewReferencePattern(base);
    assert(result.decision === 'KEEP', JSON.stringify(result));
    assert(result.reasons.includes('ONE_PROJECT_EVIDENCE_NOT_PRODUCTIZATION'), 'single-project guard missing');
  }],
  ['two independent passing projects can become candidate', () => {
    const result = reviewReferencePattern({
      ...base,
      evidence: [
        ...base.evidence,
        { sourceProject: 'FVCKU', sourceArtifactRef: 'fvcku:artifact:9', sourceVersionRef: 'v3', validationState: 'PASS', measuredOutcomeRef: 'metric:fvcku:4' },
      ],
    });
    assert(result.decision === 'PRODUCTIZATION_CANDIDATE', JSON.stringify(result));
  }],
  ['two rows from same project still count as one project', () => {
    const result = reviewReferencePattern({
      ...base,
      evidence: [
        ...base.evidence,
        { sourceProject: 'BPC', sourceArtifactRef: 'bpc:artifact:2', sourceVersionRef: 'v2', validationState: 'PASS' },
      ],
    });
    assert(result.decision !== 'PRODUCTIZATION_CANDIDATE', 'same project counted twice');
  }],
  ['hidden dependency pending blocks productization', () => {
    const result = reviewReferencePattern({
      ...base,
      hiddenDependencyReview: 'PENDING',
      evidence: [
        ...base.evidence,
        { sourceProject: 'FVCKU', sourceArtifactRef: 'fvcku:artifact:1', sourceVersionRef: 'v1', validationState: 'PASS' },
      ],
    });
    assert(result.decision === 'KEEP', JSON.stringify(result));
  }],
  ['shopify-specific capability requires adaptation', () => {
    const result = reviewReferencePattern({
      ...base,
      classification: { ...reusable, shopifySpecific: true, platformIndependent: false },
    });
    assert(result.decision === 'ADAPT', JSON.stringify(result));
  }],
  ['brand-specific operational pattern requires adaptation', () => {
    const result = reviewReferencePattern({
      ...base,
      classification: { ...reusable, reusableAiCommerceCapability: false, brandSpecific: true },
    });
    assert(result.decision === 'ADAPT', JSON.stringify(result));
  }],
  ['write-enabled learning is rejected', () => {
    const result = reviewReferencePattern({ ...base, sourceMode: 'WRITE_ALLOWED' });
    assert(result.decision === 'REJECT', JSON.stringify(result));
  }],
  ['copied customer PII is rejected', () => {
    const result = reviewReferencePattern({ ...base, rawCustomerPiiCopied: true });
    assert(result.decision === 'REJECT', JSON.stringify(result));
  }],
  ['copied secret is rejected', () => {
    const result = reviewReferencePattern({ ...base, secretCopied: true });
    assert(result.decision === 'REJECT', JSON.stringify(result));
  }],
  ['source mutation required for learning is rejected', () => {
    const result = reviewReferencePattern({ ...base, sourceMutationRequiredForLearning: true });
    assert(result.decision === 'REJECT', JSON.stringify(result));
  }],
  ['missing provenance is rejected', () => {
    const result = reviewReferencePattern({ ...base, evidence: [{ sourceProject: 'BPC', sourceArtifactRef: '', sourceVersionRef: 'v1', validationState: 'PASS' }] });
    assert(result.decision === 'REJECT', JSON.stringify(result));
  }],
  ['failed source validation is rejected', () => {
    const result = reviewReferencePattern({ ...base, evidence: [{ sourceProject: 'BPC', sourceArtifactRef: 'bpc:a', sourceVersionRef: 'v1', validationState: 'FAIL' }] });
    assert(result.decision === 'REJECT', JSON.stringify(result));
  }],
  ['open blocker prevents candidate', () => {
    const result = reviewReferencePattern({
      ...base,
      evidence: [...base.evidence, { sourceProject: 'FVCKU', sourceArtifactRef: 'fvcku:a', sourceVersionRef: 'v1', validationState: 'PASS' }],
      openBlockers: ['provider-dependent behavior'],
    });
    assert(result.decision === 'KEEP', JSON.stringify(result));
  }],
];

for (const [name, test] of tests) {
  test();
  console.log(`PASS ${name}`);
}
console.log(`REFERENCE_LEARNING_PASS ${tests.length}/${tests.length}`);
