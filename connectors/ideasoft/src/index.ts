import type { IntegrationId, MerchantWorkspaceId, UtcTimestamp } from '../../../packages/domain/src';
import {
  EvidenceGatedCommerceConnectorStub,
  connectorCapability,
  type ConnectorIdentity,
} from '../../../packages/commerce-contract/src';

export const IDEASOFT_STAGING_CAPABILITIES = Object.freeze([
  connectorCapability({ operationId: 'get_product', supportState: 'BLOCKED_BY_ACCESS', limitations: ['Exact endpoint/schema/test payload required.'] }),
  connectorCapability({ operationId: 'get_variant', supportState: 'UNKNOWN', limitations: ['Exact variant/option mapping evidence required.'] }),
  connectorCapability({ operationId: 'get_inventory', supportState: 'BLOCKED_BY_ACCESS', limitations: ['Exact inventory semantics required.'] }),
  connectorCapability({ operationId: 'get_order', supportState: 'BLOCKED_BY_ACCESS', limitations: ['Exact order/customer/completeness semantics required.'] }),
  connectorCapability({ operationId: 'get_fulfillment', supportState: 'UNKNOWN', limitations: ['No executable provider evidence admitted.'] }),
  connectorCapability({ operationId: 'get_tracking', supportState: 'UNKNOWN', limitations: ['No executable provider evidence admitted.'] }),
]);

export function createIdeaSoftEvidenceGatedStub(input: {
  merchantWorkspaceId: MerchantWorkspaceId;
  integrationId: IntegrationId;
  now: () => UtcTimestamp;
}): EvidenceGatedCommerceConnectorStub {
  const identity: ConnectorIdentity = {
    provider: 'ideasoft',
    connectorVersion: 'staging-evidence-gated',
    apiVersionState: 'EVIDENCE_REQUIRED',
    environment: 'STAGING',
    merchantWorkspaceId: input.merchantWorkspaceId,
    integrationId: input.integrationId,
  };
  return new EvidenceGatedCommerceConnectorStub(identity, IDEASOFT_STAGING_CAPABILITIES, input.now);
}
