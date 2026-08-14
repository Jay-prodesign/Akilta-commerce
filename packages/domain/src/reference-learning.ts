export const REFERENCE_DECISIONS = ['KEEP', 'ADAPT', 'REJECT', 'PRODUCTIZATION_CANDIDATE'] as const;
export type ReferenceDecision = (typeof REFERENCE_DECISIONS)[number];

export type ReferenceSourceProject = 'BPC' | 'FVCKU' | 'OTHER';
export type ReferenceValidationState = 'PASS' | 'FAIL' | 'PENDING';

export interface ReferencePatternClassification {
  readonly projectSpecific: boolean;
  readonly brandSpecific: boolean;
  readonly shopifySpecific: boolean;
  readonly commercePlatformSpecific: boolean;
  readonly platformIndependent: boolean;
  readonly reusableAiCommerceCapability: boolean;
  readonly reusableEvaluationTestCase: boolean;
  readonly reusableOperationalPattern: boolean;
  readonly reusableSafetyGovernancePattern: boolean;
}

export interface ReferenceEvidence {
  readonly sourceProject: ReferenceSourceProject;
  readonly sourceArtifactRef: string;
  readonly sourceVersionRef: string;
  readonly validationState: ReferenceValidationState;
  readonly measuredOutcomeRef?: string;
}

export interface ReferenceReviewInput {
  readonly patternId: string;
  readonly sourceMode: 'READ_ONLY' | 'WRITE_ALLOWED';
  readonly classification: ReferencePatternClassification;
  readonly evidence: readonly ReferenceEvidence[];
  readonly hiddenDependencyReview: 'PASS' | 'FAIL' | 'PENDING';
  readonly rawCustomerPiiCopied: boolean;
  readonly secretCopied: boolean;
  readonly sourceMutationRequiredForLearning: boolean;
  readonly openBlockers: readonly string[];
}

export interface ReferenceReviewResult {
  readonly decision: ReferenceDecision;
  readonly reasons: readonly string[];
  readonly distinctPassingSourceProjects: readonly ReferenceSourceProject[];
}

function passingProjects(evidence: readonly ReferenceEvidence[]): readonly ReferenceSourceProject[] {
  return [...new Set(evidence.filter((item) => item.validationState === 'PASS').map((item) => item.sourceProject))].sort();
}

function hasReusableClass(c: ReferencePatternClassification): boolean {
  return c.reusableAiCommerceCapability || c.reusableEvaluationTestCase || c.reusableOperationalPattern || c.reusableSafetyGovernancePattern;
}

export function reviewReferencePattern(input: ReferenceReviewInput): ReferenceReviewResult {
  const reasons: string[] = [];
  const passing = passingProjects(input.evidence);

  if (input.sourceMode !== 'READ_ONLY') reasons.push('SOURCE_MODE_NOT_READ_ONLY');
  if (input.rawCustomerPiiCopied) reasons.push('RAW_CUSTOMER_PII_COPIED');
  if (input.secretCopied) reasons.push('SECRET_COPIED');
  if (input.sourceMutationRequiredForLearning) reasons.push('SOURCE_MUTATION_REQUIRED');
  if (!hasReusableClass(input.classification)) reasons.push('NO_REUSABLE_CLASSIFICATION');
  if (input.evidence.some((e) => !e.sourceArtifactRef || !e.sourceVersionRef)) reasons.push('MISSING_PROVENANCE');
  if (input.evidence.some((e) => e.validationState === 'FAIL')) reasons.push('SOURCE_VALIDATION_FAILED');

  if (reasons.length > 0) {
    return { decision: 'REJECT', reasons, distinctPassingSourceProjects: passing };
  }

  if (passing.length === 0) {
    return { decision: 'KEEP', reasons: ['NO_VALIDATED_SOURCE_YET'], distinctPassingSourceProjects: passing };
  }

  const productizationReady =
    input.classification.reusableAiCommerceCapability &&
    input.classification.platformIndependent &&
    passing.length >= 2 &&
    input.hiddenDependencyReview === 'PASS' &&
    input.openBlockers.length === 0;

  if (productizationReady) {
    return {
      decision: 'PRODUCTIZATION_CANDIDATE',
      reasons: ['TWO_PROJECT_GENERALIZATION_EVIDENCE', 'HIDDEN_DEPENDENCY_REVIEW_PASS'],
      distinctPassingSourceProjects: passing,
    };
  }

  const adaptationNeeded =
    input.classification.projectSpecific ||
    input.classification.brandSpecific ||
    input.classification.shopifySpecific ||
    input.classification.commercePlatformSpecific ||
    (input.classification.reusableAiCommerceCapability && !input.classification.platformIndependent);

  if (adaptationNeeded) {
    const adaptationReasons = ['REUSABLE_WITH_DECLARED_DEPENDENCIES'];
    if (passing.length < 2) adaptationReasons.push('ONE_PROJECT_EVIDENCE_NOT_PRODUCTIZATION');
    if (input.hiddenDependencyReview !== 'PASS') adaptationReasons.push('HIDDEN_DEPENDENCY_REVIEW_NOT_PASS');
    if (input.openBlockers.length > 0) adaptationReasons.push('OPEN_BLOCKERS');
    return { decision: 'ADAPT', reasons: adaptationReasons, distinctPassingSourceProjects: passing };
  }

  const keepReasons = ['REUSABLE_REFERENCE_PATTERN'];
  if (input.classification.reusableAiCommerceCapability && passing.length < 2) {
    keepReasons.push('ONE_PROJECT_EVIDENCE_NOT_PRODUCTIZATION');
  }
  if (input.hiddenDependencyReview !== 'PASS') keepReasons.push('HIDDEN_DEPENDENCY_REVIEW_NOT_PASS');
  if (input.openBlockers.length > 0) keepReasons.push('OPEN_BLOCKERS');
  return { decision: 'KEEP', reasons: keepReasons, distinctPassingSourceProjects: passing };
}
