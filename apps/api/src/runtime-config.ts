import type { MerchantWorkspaceId, SupportState, UtcTimestamp } from '../../../packages/domain/src';

export const ENVIRONMENTS = ['LOCAL', 'DEV', 'STAGING', 'PRODUCTION'] as const;
export type EnvironmentName = (typeof ENVIRONMENTS)[number];

export type ConfigClass =
  | 'C0_VERSIONED_NON_SECRET'
  | 'C1_RUNTIME_NON_SECRET'
  | 'C2_SECRET_REFERENCE'
  | 'C4_TENANT_CONFIGURATION';

export interface SecretBindingReference {
  readonly environment: EnvironmentName;
  readonly bindingName: string;
  readonly purpose:
    | 'DATABASE'
    | 'META_AUTH'
    | 'META_SIGNING'
    | 'COMMERCE_AUTH'
    | 'AI_PROVIDER_AUTH'
    | 'AUTH_PROVIDER_VERIFIER';
}

export interface RuntimeConfigInput {
  readonly environment: EnvironmentName;
  readonly configVersion: string;
  readonly releaseLabel: string;
  readonly bindings: {
    readonly databaseReady: boolean;
    readonly queueReady: boolean;
  };
  readonly enabledCapabilities: {
    readonly asyncProcessing: boolean;
    readonly externalWebAuth: boolean;
    readonly metaWhatsApp: boolean;
    readonly aiProvider: boolean;
  };
  readonly secretReferences: readonly SecretBindingReference[];
  readonly allowedExternalHosts: readonly string[];
}

export type ConfigValidationResult =
  | { readonly status: 'VALID' }
  | { readonly status: 'INVALID'; readonly errors: readonly string[] };

function hasPurpose(config: RuntimeConfigInput, purpose: SecretBindingReference['purpose']): boolean {
  return config.secretReferences.some(
    (ref) => ref.environment === config.environment && ref.purpose === purpose && ref.bindingName.trim().length > 0,
  );
}

export function validateRuntimeConfig(config: RuntimeConfigInput): ConfigValidationResult {
  const errors: string[] = [];
  if (!config.configVersion.trim()) errors.push('CONFIG_VERSION_REQUIRED');
  if (!config.releaseLabel.trim()) errors.push('RELEASE_LABEL_REQUIRED');
  if (!config.bindings.databaseReady) errors.push('DATABASE_BINDING_REQUIRED');
  if (config.enabledCapabilities.asyncProcessing && !config.bindings.queueReady) {
    errors.push('QUEUE_BINDING_REQUIRED');
  }
  if (config.enabledCapabilities.externalWebAuth && !hasPurpose(config, 'AUTH_PROVIDER_VERIFIER')) {
    errors.push('AUTH_VERIFIER_REFERENCE_REQUIRED');
  }
  if (config.enabledCapabilities.metaWhatsApp && !hasPurpose(config, 'META_SIGNING')) {
    errors.push('META_SIGNING_REFERENCE_REQUIRED');
  }
  if (config.enabledCapabilities.metaWhatsApp && !hasPurpose(config, 'META_AUTH')) {
    errors.push('META_AUTH_REFERENCE_REQUIRED');
  }
  if (config.enabledCapabilities.aiProvider && !hasPurpose(config, 'AI_PROVIDER_AUTH')) {
    errors.push('AI_PROVIDER_REFERENCE_REQUIRED');
  }
  for (const ref of config.secretReferences) {
    if (ref.environment !== config.environment) errors.push('CROSS_ENVIRONMENT_SECRET_REFERENCE_DENIED');
    if (!ref.bindingName.trim()) errors.push('EMPTY_SECRET_REFERENCE_DENIED');
  }
  for (const host of config.allowedExternalHosts) {
    if (!host.trim() || host.includes('/') || host.includes('@')) errors.push('INVALID_EXTERNAL_HOST_ALLOWLIST_ENTRY');
  }
  return errors.length ? { status: 'INVALID', errors } : { status: 'VALID' };
}

export const SAFETY_KILL_SWITCH_KEYS = [
  'KS-AI-AUTOREPLY',
  'KS-OUTBOUND-MESSAGE',
  'KS-MERCHANT-RULE-ACTIVATION',
  'KS-COMMERCE-READ',
  'KS-AI-PROVIDER',
  'KS-CUSTOMER-ORDER-CONTEXT',
  'KS-AGENCY-CROSSWORKSPACE',
] as const;
export type SafetyKillSwitchKey = (typeof SAFETY_KILL_SWITCH_KEYS)[number];
export type SafetySwitchState = 'ALLOW' | 'STOP' | 'UNKNOWN';

export interface SafetySwitchScope {
  readonly environment: EnvironmentName;
  readonly merchantWorkspaceId?: MerchantWorkspaceId;
  readonly provider?: string;
  readonly integrationId?: string;
  readonly operation?: string;
}

export interface SafetySwitchSnapshot {
  readonly key: SafetyKillSwitchKey;
  readonly scope: SafetySwitchScope;
  readonly state: SafetySwitchState;
  readonly configVersion: string;
  readonly verifiedAt: UtcTimestamp;
  readonly sourceRef: string;
}

export type ExternalEffect =
  | 'AI_AUTOREPLY'
  | 'OUTBOUND_MESSAGE'
  | 'MERCHANT_RULE_ACTIVATION'
  | 'COMMERCE_READ'
  | 'AI_PROVIDER_CALL'
  | 'CUSTOMER_ORDER_CONTEXT'
  | 'AGENCY_CROSSWORKSPACE';

const EFFECT_SWITCH: Record<ExternalEffect, SafetyKillSwitchKey> = {
  AI_AUTOREPLY: 'KS-AI-AUTOREPLY',
  OUTBOUND_MESSAGE: 'KS-OUTBOUND-MESSAGE',
  MERCHANT_RULE_ACTIVATION: 'KS-MERCHANT-RULE-ACTIVATION',
  COMMERCE_READ: 'KS-COMMERCE-READ',
  AI_PROVIDER_CALL: 'KS-AI-PROVIDER',
  CUSTOMER_ORDER_CONTEXT: 'KS-CUSTOMER-ORDER-CONTEXT',
  AGENCY_CROSSWORKSPACE: 'KS-AGENCY-CROSSWORKSPACE',
};

function scopeMatches(snapshot: SafetySwitchSnapshot, input: ExternalEffectGateInput): boolean {
  const scope = snapshot.scope;
  if (scope.environment !== input.environment) return false;
  if (scope.merchantWorkspaceId && scope.merchantWorkspaceId !== input.merchantWorkspaceId) return false;
  if (scope.provider && scope.provider !== input.provider) return false;
  if (scope.integrationId && scope.integrationId !== input.integrationId) return false;
  if (scope.operation && scope.operation !== input.operation) return false;
  return true;
}

export interface ExternalEffectGateInput {
  readonly effect: ExternalEffect;
  readonly environment: EnvironmentName;
  readonly configVersion: string;
  readonly merchantWorkspaceId?: MerchantWorkspaceId;
  readonly provider?: string;
  readonly integrationId?: string;
  readonly operation?: string;
  readonly releaseFlagEnabled: boolean;
  readonly authorizationDecision: 'ALLOW' | 'DENY' | 'APPROVAL_REQUIRED';
  readonly providerSupportState?: SupportState;
  readonly switches: readonly SafetySwitchSnapshot[];
}

export type ExternalEffectGateDecision =
  | { readonly decision: 'ALLOW' }
  | {
      readonly decision: 'DENY';
      readonly reason:
        | 'AUTHORIZATION_NOT_ALLOWED'
        | 'RELEASE_FLAG_OFF'
        | 'PROVIDER_CAPABILITY_NOT_AVAILABLE'
        | 'KILL_SWITCH_ACTIVE'
        | 'KILL_SWITCH_UNVERIFIED';
    };

export function evaluateExternalEffectGate(input: ExternalEffectGateInput): ExternalEffectGateDecision {
  if (input.authorizationDecision !== 'ALLOW') {
    return { decision: 'DENY', reason: 'AUTHORIZATION_NOT_ALLOWED' };
  }
  if (!input.releaseFlagEnabled) return { decision: 'DENY', reason: 'RELEASE_FLAG_OFF' };
  if (input.providerSupportState && input.providerSupportState !== 'AVAILABLE') {
    return { decision: 'DENY', reason: 'PROVIDER_CAPABILITY_NOT_AVAILABLE' };
  }

  const key = EFFECT_SWITCH[input.effect];
  const matching = input.switches.filter((candidate) => candidate.key === key && scopeMatches(candidate, input));
  // A missing/unknown/stale-environment snapshot cannot silently become allow for side effects.
  const authoritative = matching.find(
    (candidate) => candidate.configVersion === input.configVersion && candidate.state !== 'UNKNOWN',
  );
  if (!authoritative) return { decision: 'DENY', reason: 'KILL_SWITCH_UNVERIFIED' };
  if (authoritative.state === 'STOP') return { decision: 'DENY', reason: 'KILL_SWITCH_ACTIVE' };
  return { decision: 'ALLOW' };
}
