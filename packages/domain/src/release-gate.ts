import {
  EVIDENCE_LEVELS,
  canEvidenceSupportClaim,
  validateEvidenceRecord,
  type EvidenceMaturity,
  type EvidenceRecord,
} from './evidence-maturity';

export const INCIDENT_SEVERITIES = ['SEV0', 'SEV1', 'SEV2', 'SEV3', 'SEV4'] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

export const RELEASE_TARGETS = [
  'GROUNDED_MESSAGING_CORE',
  'SUPPORT_LAUNCH',
  'COMMERCIAL_READY',
] as const;
export type ReleaseTarget = (typeof RELEASE_TARGETS)[number];

export const RELEASE_EVIDENCE_ROLES = [
  'BASE',
  'PROVIDER_AUTHENTIC',
  'RUNTIME_RELIABILITY',
  'RECOVERY',
  'DESIGN_PARTNER',
] as const;
export type ReleaseEvidenceRole = (typeof RELEASE_EVIDENCE_ROLES)[number];

export interface ReleaseEvidenceRequirement {
  readonly requirementId: string;
  readonly role: ReleaseEvidenceRole;
  readonly requiredMaturity: EvidenceMaturity;
  readonly record: EvidenceRecord;
}

export interface OpenDefect {
  readonly defectId: string;
  readonly severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  readonly category: 'SECURITY' | 'PRIVACY' | 'TRUTH' | 'RELIABILITY' | 'UX' | 'PROVIDER' | 'MIGRATION' | 'OTHER';
}

export interface OpenIncident {
  readonly incidentId: string;
  readonly severity: IncidentSeverity;
}

export interface ReleaseGateInput {
  readonly target: ReleaseTarget;
  readonly evidence: readonly ReleaseEvidenceRequirement[];
  readonly openDefects: readonly OpenDefect[];
  readonly openIncidents: readonly OpenIncident[];
  readonly providerClaimRequired: boolean;
  readonly commercialReviewRef?: string;
}

export type ReleaseGateDecision =
  | { readonly decision: 'PASS'; readonly target: ReleaseTarget }
  | { readonly decision: 'BLOCKED'; readonly target: ReleaseTarget; readonly reasons: readonly string[] };

function maturityIndex(level: EvidenceMaturity): number { return EVIDENCE_LEVELS.indexOf(level); }

function validPassingRole(
  evidence: readonly ReleaseEvidenceRequirement[],
  role: ReleaseEvidenceRole,
  minimum: EvidenceMaturity,
): boolean {
  return evidence.some((item) => {
    if (item.role !== role) return false;
    if (!validateEvidenceRecord(item.record).valid) return false;
    if (item.record.resultState !== 'PASS') return false;
    return maturityIndex(item.record.maturity) >= maturityIndex(minimum);
  });
}

export function evaluateReleaseGate(input: ReleaseGateInput): ReleaseGateDecision {
  const reasons: string[] = [];

  for (const item of input.evidence) {
    const validation = validateEvidenceRecord(item.record);
    if (!validation.valid) {
      reasons.push(`EVIDENCE_RECORD_INVALID:${item.requirementId}:${validation.errors.join('|')}`);
      continue;
    }
    if (!item.record.requirementIds.includes(item.requirementId)) {
      reasons.push(`EVIDENCE_REQUIREMENT_BINDING_MISSING:${item.requirementId}`);
    }
    if (item.record.resultState !== 'PASS') {
      reasons.push(`EVIDENCE_NOT_PASS:${item.requirementId}:${item.record.resultState}`);
      continue;
    }
    if (maturityIndex(item.record.maturity) < maturityIndex(item.requiredMaturity)) {
      reasons.push(`EVIDENCE_MATURITY_TOO_LOW:${item.requirementId}:${item.record.maturity}<${item.requiredMaturity}`);
    }
  }

  for (const defect of input.openDefects) {
    if (defect.severity === 'CRITICAL' || defect.severity === 'HIGH') {
      reasons.push(`OPEN_${defect.severity}_DEFECT:${defect.defectId}:${defect.category}`);
    }
  }

  for (const incident of input.openIncidents) {
    if (incident.severity === 'SEV0' || incident.severity === 'SEV1') {
      reasons.push(`OPEN_${incident.severity}_INCIDENT:${incident.incidentId}`);
    }
  }

  if (input.providerClaimRequired) {
    const providerEvidence = input.evidence.some((item) =>
      item.role === 'PROVIDER_AUTHENTIC' &&
      item.record.requirementIds.includes(item.requirementId) &&
      canEvidenceSupportClaim(item.record, 'TARGET_PROVIDER_OPERATION_SUPPORTED'),
    );
    if (!providerEvidence) reasons.push('PROVIDER_E3_EVIDENCE_MISSING');
  }

  if (input.target === 'SUPPORT_LAUNCH' || input.target === 'COMMERCIAL_READY') {
    if (!validPassingRole(input.evidence, 'RUNTIME_RELIABILITY', 'E3_PROVIDER_AUTHENTIC_PASS')) {
      reasons.push('RUNTIME_RELIABILITY_EVIDENCE_MISSING');
    }
    if (!validPassingRole(input.evidence, 'RECOVERY', 'E3_PROVIDER_AUTHENTIC_PASS')) {
      reasons.push('RECOVERY_EVIDENCE_MISSING');
    }
  }

  if (input.target === 'COMMERCIAL_READY') {
    if (!validPassingRole(input.evidence, 'DESIGN_PARTNER', 'E5_DESIGN_PARTNER_PILOT_PASS')) {
      reasons.push('DESIGN_PARTNER_E5_EVIDENCE_MISSING');
    }
    if (!input.commercialReviewRef) reasons.push('COMMERCIAL_REVIEW_REF_MISSING');
  }

  return reasons.length > 0
    ? { decision: 'BLOCKED', target: input.target, reasons }
    : { decision: 'PASS', target: input.target };
}

export const INCIDENT_STOP_CONDITIONS = [
  'CROSS_TENANT_LEAKAGE',
  'SECRET_EXPOSURE',
  'UNAUTHORIZED_EXTERNAL_ACTION',
  'APPROVAL_BYPASS_OR_REPLAY',
  'SYSTEMIC_WRONG_CUSTOMER_DISCLOSURE',
  'UNBOUNDED_DUPLICATE_OUTBOUND_SEND',
  'MATERIAL_UNSAFE_TRUTH_FAILURE_AT_SCALE',
  'UNSAFE_PROVIDER_MAPPING_DRIFT',
] as const;
export type IncidentStopCondition = (typeof INCIDENT_STOP_CONDITIONS)[number];

export function incidentRequiresImmediateStop(condition: IncidentStopCondition): boolean {
  return INCIDENT_STOP_CONDITIONS.includes(condition);
}
