export const EVIDENCE_LEVELS = [
  'E0_SPECIFIED',
  'E1_SYNTHETIC_PASS',
  'E2_PROVIDER_REFERENCE_PASS',
  'E3_PROVIDER_AUTHENTIC_PASS',
  'E4_OWNED_DOGFOOD_PASS',
  'E5_DESIGN_PARTNER_PILOT_PASS',
  'E6_COMMERCIAL_READY_PASS',
] as const;
export type EvidenceMaturity = (typeof EVIDENCE_LEVELS)[number];

export const TEST_RESULT_STATES = [
  'NOT_RUN',
  'PASS',
  'FAIL',
  'BLOCKED_BY_PROVIDER_ACCESS',
  'BLOCKED_BY_OWNER_ACCESS',
  'BLOCKED_BY_ENVIRONMENT',
  'UNSUPPORTED',
  'NOT_APPLICABLE',
  'SUPERSEDED',
] as const;
export type TestResultState = (typeof TEST_RESULT_STATES)[number];

export type EvidenceClaim =
  | 'SPECIFICATION_EXISTS'
  | 'GENERIC_LOGIC_WORKS'
  | 'REFERENCE_SUPPORTS_ABSTRACTION'
  | 'TARGET_PROVIDER_OPERATION_SUPPORTED'
  | 'OWNED_DOGFOOD_READY'
  | 'DESIGN_PARTNER_PILOT_PASSED'
  | 'COMMERCIAL_READY';

export interface EvidenceRecord {
  readonly testId: string;
  readonly requirementIds: readonly string[];
  readonly capability: string;
  readonly resultState: TestResultState;
  readonly maturity: EvidenceMaturity;
  readonly evidenceRefs: readonly string[];
  readonly providerRef?: string;
  readonly exactOperationRef?: string;
  readonly authEvidenceRef?: string;
  readonly dogfoodRef?: string;
  readonly designPartnerRef?: string;
  readonly commercialGateRefs?: readonly string[];
}

const rank = new Map<EvidenceMaturity, number>(EVIDENCE_LEVELS.map((level, index) => [level, index]));

const minimumByClaim: Record<EvidenceClaim, EvidenceMaturity> = {
  SPECIFICATION_EXISTS: 'E0_SPECIFIED',
  GENERIC_LOGIC_WORKS: 'E1_SYNTHETIC_PASS',
  REFERENCE_SUPPORTS_ABSTRACTION: 'E2_PROVIDER_REFERENCE_PASS',
  TARGET_PROVIDER_OPERATION_SUPPORTED: 'E3_PROVIDER_AUTHENTIC_PASS',
  OWNED_DOGFOOD_READY: 'E4_OWNED_DOGFOOD_PASS',
  DESIGN_PARTNER_PILOT_PASSED: 'E5_DESIGN_PARTNER_PILOT_PASS',
  COMMERCIAL_READY: 'E6_COMMERCIAL_READY_PASS',
};

export interface EvidenceValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export function validateEvidenceRecord(record: EvidenceRecord): EvidenceValidationResult {
  const errors: string[] = [];
  if (!record.testId) errors.push('TEST_ID_REQUIRED');
  if (record.requirementIds.length === 0) errors.push('REQUIREMENT_ID_REQUIRED');
  if (!record.capability) errors.push('CAPABILITY_REQUIRED');

  const maturityRank = rank.get(record.maturity);
  if (maturityRank === undefined) errors.push('UNKNOWN_MATURITY');

  if (record.maturity === 'E0_SPECIFIED' && record.resultState === 'PASS') {
    errors.push('E0_CANNOT_PROVE_EXECUTABLE_PASS');
  }
  if (record.maturity !== 'E0_SPECIFIED' && record.resultState === 'PASS' && record.evidenceRefs.length === 0) {
    errors.push('PASS_REQUIRES_EVIDENCE_REF');
  }

  if (maturityRank !== undefined && maturityRank >= rank.get('E3_PROVIDER_AUTHENTIC_PASS')!) {
    if (!record.providerRef) errors.push('E3_PROVIDER_REF_REQUIRED');
    if (!record.exactOperationRef) errors.push('E3_EXACT_OPERATION_REQUIRED');
    if (!record.authEvidenceRef) errors.push('E3_AUTH_EVIDENCE_REQUIRED');
  }
  if (maturityRank !== undefined && maturityRank >= rank.get('E4_OWNED_DOGFOOD_PASS')! && !record.dogfoodRef) {
    errors.push('E4_DOGFOOD_REF_REQUIRED');
  }
  if (maturityRank !== undefined && maturityRank >= rank.get('E5_DESIGN_PARTNER_PILOT_PASS')! && !record.designPartnerRef) {
    errors.push('E5_DESIGN_PARTNER_REF_REQUIRED');
  }
  if (record.maturity === 'E6_COMMERCIAL_READY_PASS' && (record.commercialGateRefs?.length ?? 0) === 0) {
    errors.push('E6_COMMERCIAL_GATES_REQUIRED');
  }

  return { valid: errors.length === 0, errors };
}

export function canEvidenceSupportClaim(record: EvidenceRecord, claim: EvidenceClaim): boolean {
  const validation = validateEvidenceRecord(record);
  if (!validation.valid) return false;

  // Documentation is evidence for existence only; every executable/operational claim needs PASS.
  if (claim !== 'SPECIFICATION_EXISTS' && record.resultState !== 'PASS') return false;
  if (claim === 'SPECIFICATION_EXISTS' && record.resultState === 'FAIL') return false;

  const actual = rank.get(record.maturity);
  const required = rank.get(minimumByClaim[claim]);
  return actual !== undefined && required !== undefined && actual >= required;
}
