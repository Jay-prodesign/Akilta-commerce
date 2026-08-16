import type { IntegrationId, MerchantWorkspaceId, UtcTimestamp } from '../../../packages/domain/src';
import {
  EvidenceGatedCommerceConnectorStub,
  connectorCapability,
  type ConnectorIdentity,
} from '../../../packages/commerce-contract/src';

export const IKAS_STAGING_CAPABILITIES = Object.freeze([
  connectorCapability({ operationId: 'get_product', supportState: 'BLOCKED_BY_ACCESS', limitations: ['Official E2 Admin API references product/variant identity, but provider-authentic auth + operation payload/readback is required before mapping admission.'] }),
  connectorCapability({ operationId: 'get_variant', supportState: 'BLOCKED_BY_ACCESS', limitations: ['Exact real option/variant mapping and stable identifier behavior require E3 provider-authentic evidence.'] }),
  connectorCapability({ operationId: 'get_inventory', supportState: 'BLOCKED_BY_ACCESS', limitations: ['Official E2 evidence includes location-aware stock input; exact sellability/tracking/policy semantics and real response mapping remain unverified.'] }),
  connectorCapability({ operationId: 'get_order', supportState: 'BLOCKED_BY_ACCESS', limitations: ['Official E2 evidence covers order identity/status/total/timestamps and pagination shape; real customer/order disclosure and completeness semantics require E3 evidence.'] }),
  connectorCapability({ operationId: 'get_fulfillment', supportState: 'UNKNOWN', limitations: ['No provider-authentic fulfillment mapping is admitted.'] }),
  connectorCapability({ operationId: 'get_tracking', supportState: 'UNKNOWN', limitations: ['No provider-authentic shipment/tracking mapping is admitted.'] }),
  connectorCapability({ operationId: 'process_webhook', supportState: 'BLOCKED_BY_ACCESS', limitations: ['Webhook scope families, retry behavior and signature-validation requirement have E2 evidence; exact signature algorithm, payload schema and runtime endpoint/account environment remain unverified.'] }),
]);

export function createIkasEvidenceGatedStub(input: {
  merchantWorkspaceId: MerchantWorkspaceId;
  integrationId: IntegrationId;
  now: () => UtcTimestamp;
}): EvidenceGatedCommerceConnectorStub {
  const identity: ConnectorIdentity = {
    provider: 'ikas',
    connectorVersion: 'phase1b-staging-e2-evidence-gated',
    apiVersionState: 'EVIDENCE_REQUIRED',
    environment: 'STAGING',
    merchantWorkspaceId: input.merchantWorkspaceId,
    integrationId: input.integrationId,
  };
  return new EvidenceGatedCommerceConnectorStub(identity, IKAS_STAGING_CAPABILITIES, input.now);
}
