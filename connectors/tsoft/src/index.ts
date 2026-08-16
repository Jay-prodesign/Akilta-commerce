import type { IntegrationId, MerchantWorkspaceId, UtcTimestamp } from '../../../packages/domain/src';
import {
  EvidenceGatedCommerceConnectorStub,
  connectorCapability,
  type ConnectorIdentity,
} from '../../../packages/commerce-contract/src';

export const TSOFT_STAGING_CAPABILITIES = Object.freeze([
  connectorCapability({ operationId: 'get_product', supportState: 'BLOCKED_BY_ACCESS', limitations: ['Official E2 Web Service evidence does not yet admit an exact real Product mapping for this connector.'] }),
  connectorCapability({ operationId: 'get_variant', supportState: 'BLOCKED_BY_ACCESS', limitations: ['Exact product/variant identifiers, option labels and stable mapping semantics require provider-authentic evidence.'] }),
  connectorCapability({ operationId: 'get_inventory', supportState: 'BLOCKED_BY_ACCESS', limitations: ['T-Soft E2 stock settings show negative-stock, real-stock and payment-timing policies; raw quantity must not be treated as portable sellability and real mapping remains E3-gated.'] }),
  connectorCapability({ operationId: 'get_order', supportState: 'BLOCKED_BY_ACCESS', limitations: ['Order query fields are visible at E2 reference level, but merchant-specific auth, payload completeness and customer disclosure semantics require provider-authentic execution evidence.'] }),
  connectorCapability({ operationId: 'get_fulfillment', supportState: 'UNKNOWN', limitations: ['No provider-authentic fulfillment mapping is admitted.'] }),
  connectorCapability({ operationId: 'get_tracking', supportState: 'UNKNOWN', limitations: ['No provider-authentic shipment/tracking mapping is admitted.'] }),
  connectorCapability({ operationId: 'process_webhook', supportState: 'BLOCKED_BY_ACCESS', limitations: ['Official E2 webhook material describes configuration and retry/queue behavior, but exact authenticity semantics, payload mapping, limits and merchant execution remain unverified.'] }),
]);

export function createTsoftEvidenceGatedStub(input: {
  merchantWorkspaceId: MerchantWorkspaceId;
  integrationId: IntegrationId;
  now: () => UtcTimestamp;
}): EvidenceGatedCommerceConnectorStub {
  const identity: ConnectorIdentity = {
    provider: 'tsoft',
    connectorVersion: 'phase1b-staging-e2-evidence-gated',
    apiVersionState: 'EVIDENCE_REQUIRED',
    environment: 'STAGING',
    merchantWorkspaceId: input.merchantWorkspaceId,
    integrationId: input.integrationId,
  };
  return new EvidenceGatedCommerceConnectorStub(identity, TSOFT_STAGING_CAPABILITIES, input.now);
}
