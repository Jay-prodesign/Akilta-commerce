import type { IntegrationId, MerchantWorkspaceId } from '../../../packages/domain/src';

export type WebhookAuthenticityState = 'UNVERIFIED' | 'VERIFIED' | 'INVALID' | 'UNSUPPORTED';

export interface ServerResolvedWebhookIntegrationBinding {
  readonly integrationId: IntegrationId;
  readonly merchantWorkspaceId: MerchantWorkspaceId;
}

export interface WebhookIngressContext {
  readonly authenticity: WebhookAuthenticityState;
  /** Server-resolved target tenant. Never trust provider/body tenant data as authority. */
  readonly merchantWorkspaceId?: MerchantWorkspaceId;
  /** Routing candidate selected from safe route/integration hints. Not sufficient for enqueue authority. */
  readonly integrationId?: IntegrationId;
  /** Current Integration record binding loaded server-side after authenticity verification. */
  readonly serverResolvedIntegration?: ServerResolvedWebhookIntegrationBinding;
  readonly sourceEventRef?: string;
}

export type WebhookIngressDecision =
  | { readonly decision: 'REJECT'; readonly reason: 'AUTHENTICITY_NOT_VERIFIED' | 'TENANT_NOT_RESOLVED' | 'INTEGRATION_NOT_RESOLVED' | 'INTEGRATION_BINDING_NOT_RESOLVED' | 'INTEGRATION_ID_MISMATCH' | 'INTEGRATION_WORKSPACE_MISMATCH' }
  | { readonly decision: 'ALLOW_NORMALIZE_AND_ENQUEUE'; readonly merchantWorkspaceId: MerchantWorkspaceId; readonly integrationId: IntegrationId };

export function decideWebhookIngress(input: WebhookIngressContext): WebhookIngressDecision {
  if (input.authenticity !== 'VERIFIED') return { decision: 'REJECT', reason: 'AUTHENTICITY_NOT_VERIFIED' };
  if (input.merchantWorkspaceId === undefined) return { decision: 'REJECT', reason: 'TENANT_NOT_RESOLVED' };
  if (input.integrationId === undefined) return { decision: 'REJECT', reason: 'INTEGRATION_NOT_RESOLVED' };
  if (input.serverResolvedIntegration === undefined) {
    return { decision: 'REJECT', reason: 'INTEGRATION_BINDING_NOT_RESOLVED' };
  }
  if (input.serverResolvedIntegration.integrationId !== input.integrationId) {
    return { decision: 'REJECT', reason: 'INTEGRATION_ID_MISMATCH' };
  }
  if (input.serverResolvedIntegration.merchantWorkspaceId !== input.merchantWorkspaceId) {
    return { decision: 'REJECT', reason: 'INTEGRATION_WORKSPACE_MISMATCH' };
  }
  return {
    decision: 'ALLOW_NORMALIZE_AND_ENQUEUE',
    merchantWorkspaceId: input.serverResolvedIntegration.merchantWorkspaceId,
    integrationId: input.serverResolvedIntegration.integrationId,
  };
}
