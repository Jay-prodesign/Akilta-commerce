/**
 * Framework-independent CR-V1 presentation contracts derived from artifact 22 UX-01..UX-15.
 * These functions consume server/domain DTO states and produce display policy only.
 * They never grant tenant, customer-disclosure, approval, provider, or action authority.
 */

export const CLIENT_AUTHORITY_POLICY = Object.freeze({
  routeParamsAuthorize: false,
  workspaceSelectionAuthorizes: false,
  hiddenControlsAuthorize: false,
  cachedStateAuthorizes: false,
  serverRecheckRequired: true,
} as const);

export type UiSemantic = 'READY' | 'INFO' | 'WARNING' | 'BLOCKED' | 'ERROR';

export type OnboardingIntegrationState =
  | 'UNCONFIGURED'
  | 'CONNECTING'
  | 'CONNECTED_UNVERIFIED'
  | 'VERIFIED'
  | 'DEGRADED'
  | 'ERROR';

export interface OnboardingIntegrationPresentation {
  readonly semantic: UiSemantic;
  readonly verified: boolean;
  readonly readyForPilotClaim: boolean;
  readonly label: string;
}

export function onboardingIntegrationPresentation(
  state: OnboardingIntegrationState,
): OnboardingIntegrationPresentation {
  switch (state) {
    case 'VERIFIED':
      return { semantic: 'READY', verified: true, readyForPilotClaim: true, label: 'Verified' };
    case 'DEGRADED':
      return { semantic: 'WARNING', verified: false, readyForPilotClaim: false, label: 'Degraded' };
    case 'ERROR':
      return { semantic: 'ERROR', verified: false, readyForPilotClaim: false, label: 'Error' };
    case 'CONNECTED_UNVERIFIED':
      return { semantic: 'WARNING', verified: false, readyForPilotClaim: false, label: 'Connected — verification pending' };
    case 'CONNECTING':
      return { semantic: 'INFO', verified: false, readyForPilotClaim: false, label: 'Connecting' };
    case 'UNCONFIGURED':
      return { semantic: 'INFO', verified: false, readyForPilotClaim: false, label: 'Not configured' };
  }
}

export type InventoryAvailabilityState = 'IN_STOCK' | 'OUT_OF_STOCK' | 'AVAILABLE_TO_ORDER' | 'UNKNOWN';
export type EvidenceFreshnessState = 'FRESH' | 'STALE' | 'UNKNOWN';

export interface InventoryPresentation {
  readonly semantic: UiSemantic;
  readonly availabilityClaim: InventoryAvailabilityState;
  readonly label: string;
  readonly verifiedCurrentState: boolean;
}

export function inventoryPresentation(input: {
  readonly availability: InventoryAvailabilityState;
  readonly freshness: EvidenceFreshnessState;
}): InventoryPresentation {
  if (input.freshness !== 'FRESH' || input.availability === 'UNKNOWN') {
    return {
      semantic: 'WARNING',
      availabilityClaim: 'UNKNOWN',
      label: 'Cannot verify current stock',
      verifiedCurrentState: false,
    };
  }
  if (input.availability === 'OUT_OF_STOCK') {
    return {
      semantic: 'BLOCKED',
      availabilityClaim: 'OUT_OF_STOCK',
      label: 'Out of stock',
      verifiedCurrentState: true,
    };
  }
  if (input.availability === 'AVAILABLE_TO_ORDER') {
    return {
      semantic: 'INFO',
      availabilityClaim: 'AVAILABLE_TO_ORDER',
      label: 'Available to order',
      verifiedCurrentState: true,
    };
  }
  return {
    semantic: 'READY',
    availabilityClaim: 'IN_STOCK',
    label: 'In stock',
    verifiedCurrentState: true,
  };
}

export type CustomerVerificationLevel = 'CV0' | 'CV1' | 'CV2' | 'CV3';

export interface CustomerContextDisclosurePresentation {
  readonly verificationLevel: CustomerVerificationLevel;
  readonly showCustomerSpecificOrderDetails: boolean;
  readonly showVerificationWarning: boolean;
  readonly label: string;
}

export function customerContextDisclosurePresentation(
  verificationLevel: CustomerVerificationLevel,
): CustomerContextDisclosurePresentation {
  if (verificationLevel === 'CV0') {
    return {
      verificationLevel,
      showCustomerSpecificOrderDetails: false,
      showVerificationWarning: true,
      label: 'Unverified customer context',
    };
  }
  return {
    verificationLevel,
    showCustomerSpecificOrderDetails: true,
    showVerificationWarning: false,
    label: verificationLevel === 'CV1' ? 'Bounded verified match' : 'Verified customer context',
  };
}

export type OrderHistoryScope = 'FULL_HISTORY' | 'BOUNDED' | 'UNKNOWN';

export interface OrderHistoryPresentation {
  readonly label: string;
  readonly mayClaimLifetimeComplete: boolean;
  readonly semantic: UiSemantic;
}

export function orderHistoryPresentation(scope: OrderHistoryScope): OrderHistoryPresentation {
  switch (scope) {
    case 'FULL_HISTORY':
      return { label: 'All accessible orders', mayClaimLifetimeComplete: true, semantic: 'INFO' };
    case 'BOUNDED':
      return { label: 'Recent accessible orders', mayClaimLifetimeComplete: false, semantic: 'WARNING' };
    case 'UNKNOWN':
      return { label: 'Order history scope not verified', mayClaimLifetimeComplete: false, semantic: 'WARNING' };
  }
}

export type AgentAssistPresentationState =
  | 'DRAFT_READY'
  | 'DRAFT_WITH_WARNING'
  | 'BLOCKED_UNKNOWN'
  | 'BLOCKED_POLICY_CONFLICT'
  | 'HANDOFF_RECOMMENDED';

export function agentAssistPresentation(input: {
  readonly evidenceCount: number;
  readonly hasCriticalUnknown: boolean;
  readonly hasPolicyConflict: boolean;
  readonly handoffRequired?: boolean;
}): AgentAssistPresentationState {
  if (input.handoffRequired) return 'HANDOFF_RECOMMENDED';
  if (input.hasPolicyConflict) return 'BLOCKED_POLICY_CONFLICT';
  if (input.hasCriticalUnknown) return 'BLOCKED_UNKNOWN';
  if (input.evidenceCount <= 0) return 'DRAFT_WITH_WARNING';
  return 'DRAFT_READY';
}

export interface RulePresentation {
  readonly activationAllowed: boolean;
  readonly conflictVisible: boolean;
  readonly rollbackTargetLabel?: string;
  readonly rollbackPreservesHistory: true;
}

export function merchantRulePresentation(input: {
  readonly hasConflict: boolean;
  readonly rollbackTargetVersion?: string;
}): RulePresentation {
  return Object.freeze({
    activationAllowed: !input.hasConflict,
    conflictVisible: input.hasConflict,
    ...(input.rollbackTargetVersion
      ? { rollbackTargetLabel: `Restore version ${input.rollbackTargetVersion}` }
      : {}),
    rollbackPreservesHistory: true,
  });
}

export type IntegrationSupportState = 'AVAILABLE' | 'UNSUPPORTED' | 'UNKNOWN' | 'STALE' | 'ERROR' | 'BLOCKED_BY_ACCESS';

export interface IntegrationHealthPresentation {
  readonly semantic: UiSemantic;
  readonly degradedVisible: boolean;
  readonly label: string;
}

export function integrationHealthPresentation(state: IntegrationSupportState): IntegrationHealthPresentation {
  switch (state) {
    case 'AVAILABLE': return { semantic: 'READY', degradedVisible: false, label: 'Available' };
    case 'STALE': return { semantic: 'WARNING', degradedVisible: true, label: 'Degraded / stale evidence' };
    case 'ERROR': return { semantic: 'ERROR', degradedVisible: true, label: 'Provider error' };
    case 'BLOCKED_BY_ACCESS': return { semantic: 'BLOCKED', degradedVisible: true, label: 'Access required' };
    case 'UNSUPPORTED': return { semantic: 'BLOCKED', degradedVisible: false, label: 'Unsupported' };
    case 'UNKNOWN': return { semantic: 'WARNING', degradedVisible: true, label: 'Unknown / not verified' };
  }
}

export type IntegrationContextActionAuthorityState =
  | 'READY'
  | 'OWNER_APPROVAL_REQUIRED'
  | 'AUTHORIZATION_DENIED'
  | 'SOURCE_PROJECT_NON_INTERFERENCE'
  | 'TARGET_CONTEXT_MISMATCH'
  | 'POST_READ_REQUIRED';

export interface IntegrationContextActionPresentation {
  readonly semantic: UiSemantic;
  readonly actionEnabled: boolean;
  readonly requiresOwnerApproval: boolean;
  readonly permissionDenied: boolean;
  readonly nonInterferenceBlocked: boolean;
  readonly serverRecheckRequired: true;
  readonly label: string;
}

/**
 * Presentation-only projection of the server authority/settlement state for integration-context changes.
 * The client never derives READY from local permissions, owner text, route state, or cached connector state.
 */
export function integrationContextActionPresentation(
  state: IntegrationContextActionAuthorityState,
): IntegrationContextActionPresentation {
  switch (state) {
    case 'READY':
      return {
        semantic: 'READY',
        actionEnabled: true,
        requiresOwnerApproval: false,
        permissionDenied: false,
        nonInterferenceBlocked: false,
        serverRecheckRequired: true,
        label: 'Ready for exact bounded integration change',
      };
    case 'OWNER_APPROVAL_REQUIRED':
      return {
        semantic: 'BLOCKED',
        actionEnabled: false,
        requiresOwnerApproval: true,
        permissionDenied: false,
        nonInterferenceBlocked: false,
        serverRecheckRequired: true,
        label: 'Owner approval required',
      };
    case 'AUTHORIZATION_DENIED':
      return {
        semantic: 'BLOCKED',
        actionEnabled: false,
        requiresOwnerApproval: false,
        permissionDenied: true,
        nonInterferenceBlocked: false,
        serverRecheckRequired: true,
        label: 'You do not have permission for this integration change',
      };
    case 'SOURCE_PROJECT_NON_INTERFERENCE':
      return {
        semantic: 'BLOCKED',
        actionEnabled: false,
        requiresOwnerApproval: false,
        permissionDenied: false,
        nonInterferenceBlocked: true,
        serverRecheckRequired: true,
        label: 'Blocked — active project connection must not be disrupted',
      };
    case 'TARGET_CONTEXT_MISMATCH':
      return {
        semantic: 'ERROR',
        actionEnabled: false,
        requiresOwnerApproval: false,
        permissionDenied: false,
        nonInterferenceBlocked: false,
        serverRecheckRequired: true,
        label: 'Target connection does not match the approved context',
      };
    case 'POST_READ_REQUIRED':
      return {
        semantic: 'INFO',
        actionEnabled: false,
        requiresOwnerApproval: false,
        permissionDenied: false,
        nonInterferenceBlocked: false,
        serverRecheckRequired: true,
        label: 'Connection change pending verification readback',
      };
  }
}

export type CostKnowledgeState = 'KNOWN' | 'UNKNOWN' | 'UNRECONCILED';

export interface UsageCostPresentation {
  readonly state: CostKnowledgeState;
  readonly displayValue: string;
  readonly numericZeroClaim: boolean;
  readonly semantic: UiSemantic;
}

export function usageCostPresentation(input: {
  readonly state: CostKnowledgeState;
  readonly minorUnits?: bigint;
  readonly currency?: string;
}): UsageCostPresentation {
  if (input.state !== 'KNOWN' || input.minorUnits === undefined || !input.currency) {
    return {
      state: input.state,
      displayValue: input.state === 'UNRECONCILED' ? 'Cost unreconciled' : 'Cost unknown',
      numericZeroClaim: false,
      semantic: 'WARNING',
    };
  }
  return {
    state: 'KNOWN',
    displayValue: `${input.currency} minor:${input.minorUnits.toString()}`,
    numericZeroClaim: input.minorUnits === 0n,
    semantic: 'INFO',
  };
}

export const CRITICAL_WARNING_CODES = [
  'STOCK_UNVERIFIED',
  'ORDER_VERIFICATION_REQUIRED',
  'PROVIDER_UNAVAILABLE',
  'APPROVAL_REQUIRED',
  'PERMISSION_DENIED',
  'PROVIDER_UNSUPPORTED',
  'FACT_CONFLICT',
  'HUMAN_TAKEOVER',
] as const;
export type CriticalWarningCode = (typeof CRITICAL_WARNING_CODES)[number];
export type SupportedUiLocale = 'tr-TR' | 'en-US';

const WARNING_TEXT: Record<CriticalWarningCode, Record<SupportedUiLocale, string>> = {
  STOCK_UNVERIFIED: { 'tr-TR': 'Güncel stok doğrulanamıyor', 'en-US': 'Current stock cannot be verified' },
  ORDER_VERIFICATION_REQUIRED: { 'tr-TR': 'Sipariş bilgisi için doğrulama gerekli', 'en-US': 'Verification is required for order information' },
  PROVIDER_UNAVAILABLE: { 'tr-TR': 'Sağlayıcı geçici olarak kullanılamıyor', 'en-US': 'Provider is temporarily unavailable' },
  APPROVAL_REQUIRED: { 'tr-TR': 'Bu işlem için onay gerekli', 'en-US': 'This action requires approval' },
  PERMISSION_DENIED: { 'tr-TR': 'Bu işlem için yetkiniz yok', 'en-US': 'You do not have permission for this action' },
  PROVIDER_UNSUPPORTED: { 'tr-TR': 'Bu sağlayıcı özelliği desteklenmiyor', 'en-US': 'This provider feature is not supported' },
  FACT_CONFLICT: { 'tr-TR': 'Bilgiler çelişiyor ve inceleme gerekiyor', 'en-US': 'Information conflicts and requires review' },
  HUMAN_TAKEOVER: { 'tr-TR': 'İnsan destek temsilcisi devraldı', 'en-US': 'Human support has taken over' },
};

export interface LocalizedCriticalWarning {
  readonly semanticCode: CriticalWarningCode;
  readonly locale: SupportedUiLocale;
  readonly text: string;
}

export function localizedCriticalWarning(
  semanticCode: CriticalWarningCode,
  locale: SupportedUiLocale,
): LocalizedCriticalWarning {
  return Object.freeze({ semanticCode, locale, text: WARNING_TEXT[semanticCode][locale] });
}

export const CUSTOMER_VISIBLE_SEND_LINEAGE_STAGES = [
  'INBOUND_EVENT',
  'TENANT_IDENTITY_CONTEXT',
  'EVIDENCE_READ',
  'AI_FIRST_OUTPUT',
  'FINAL_CUSTOMER_OUTPUT',
  'PROVIDER_RESULT',
] as const;
export type CustomerVisibleSendLineageStage = (typeof CUSTOMER_VISIBLE_SEND_LINEAGE_STAGES)[number];

export interface SendLineagePresentation {
  readonly reconstructable: boolean;
  readonly missingStages: readonly CustomerVisibleSendLineageStage[];
  readonly orderValid: boolean;
}

export function sendLineagePresentation(
  stages: readonly CustomerVisibleSendLineageStage[],
): SendLineagePresentation {
  const missingStages = CUSTOMER_VISIBLE_SEND_LINEAGE_STAGES.filter((required) => !stages.includes(required));
  let previous = -1;
  let orderValid = true;
  for (const required of CUSTOMER_VISIBLE_SEND_LINEAGE_STAGES) {
    const index = stages.indexOf(required);
    if (index < 0) continue;
    if (index <= previous) orderValid = false;
    previous = index;
  }
  return Object.freeze({
    reconstructable: missingStages.length === 0 && orderValid,
    missingStages,
    orderValid,
  });
}
