export const PROVIDER_REFERENCE_EVIDENCE_STATES = [
  'CONFIRMED',
  'CONFIRMED_HIGH_LEVEL',
  'NOT_ASSUMED',
] as const;

export type ProviderReferenceEvidenceState = (typeof PROVIDER_REFERENCE_EVIDENCE_STATES)[number];

export const PROVIDER_REFERENCE_MATURITY = ['E0_SPECIFIED', 'E2_PROVIDER_REFERENCE_PASS'] as const;
export type ProviderReferenceMaturity = (typeof PROVIDER_REFERENCE_MATURITY)[number];

export interface ProviderPublicReferenceCapability {
  readonly provider: string;
  readonly capabilityKey: string;
  readonly normalizedOperation?: string;
  readonly evidenceState: ProviderReferenceEvidenceState;
  readonly evidenceMaturity: ProviderReferenceMaturity;
  readonly evidenceRefs: readonly string[];
  readonly lastVerifiedAt: string;
  readonly limitations: readonly string[];
  readonly exactSchemaAdmitted: false;
  readonly executionAdmitted: false;
}

function nonEmpty(value: string, field: string): string {
  if (!value.trim()) throw new Error(`PROVIDER_REFERENCE_EMPTY:${field}`);
  return value;
}

export function providerPublicReferenceCapability(
  input: Omit<ProviderPublicReferenceCapability, 'exactSchemaAdmitted' | 'executionAdmitted'>,
): ProviderPublicReferenceCapability {
  nonEmpty(input.provider, 'provider');
  nonEmpty(input.capabilityKey, 'capabilityKey');
  nonEmpty(input.lastVerifiedAt, 'lastVerifiedAt');

  if (input.evidenceState !== 'NOT_ASSUMED' && input.evidenceRefs.length === 0) {
    throw new Error(`PROVIDER_REFERENCE_EVIDENCE_REQUIRED:${input.provider}:${input.capabilityKey}`);
  }
  if (input.evidenceMaturity === 'E2_PROVIDER_REFERENCE_PASS' && input.evidenceRefs.length === 0) {
    throw new Error(`PROVIDER_REFERENCE_E2_EVIDENCE_REQUIRED:${input.provider}:${input.capabilityKey}`);
  }

  return Object.freeze({
    ...input,
    evidenceRefs: Object.freeze([...input.evidenceRefs]),
    limitations: Object.freeze([...input.limitations]),
    exactSchemaAdmitted: false as const,
    executionAdmitted: false as const,
  });
}

export type ExecutionAdmissionEvidence = {
  readonly maturity: 'E3_PROVIDER_AUTHENTIC_PASS' | 'E4_OWNED_DOGFOOD_PASS' | 'E5_DESIGN_PARTNER_PILOT_PASS' | 'E6_COMMERCIAL_READY_PASS';
  readonly provider: string;
  readonly operationKey: string;
  readonly authEvidenceRefs: readonly string[];
  readonly operationEvidenceRefs: readonly string[];
};

/** Public/provider-reference evidence can inform design, but never grants adapter execution authority. */
export function canAdmitProviderExecution(evidence: ExecutionAdmissionEvidence): boolean {
  return Boolean(
    evidence.provider.trim() &&
      evidence.operationKey.trim() &&
      evidence.authEvidenceRefs.length > 0 &&
      evidence.operationEvidenceRefs.length > 0,
  );
}

export function referenceCanClaimTargetProviderSupport(_reference: ProviderPublicReferenceCapability): false {
  return false;
}
