import type { IntegrationId, MerchantWorkspaceId, UtcTimestamp } from '../../../packages/domain/src';
import {
  EvidenceGatedCommerceConnectorStub,
  connectorCapability,
  type ConnectorIdentity,
} from '../../../packages/commerce-contract/src';

export * from './mapping';
export * from './parse-product-response';

/**
 * D-099 designates Shopify the default REFERENCE_CONNECTOR for AC v1.0. This module is the
 * Shopify counterpart to the existing Ticimax/IdeaSoft/ikas/T-Soft/Meta evidence-gated stubs:
 * it declares only what real, provider-authentic (E3) execution requires and stays fail-closed
 * until an isolated AI Commerce Shopify development-store target exists and D-100
 * target-context re-verification passes (SHOPIFY_TARGET_CONTEXT_ACCESS_GATE). No store
 * credential, execution or mutation authority is created here. Limitations below cite exact
 * Shopify Admin GraphQL schema facts confirmed by read-only schema introspection this session
 * (E2 provider-reference level) and are not guessed.
 */
export const SHOPIFY_STAGING_CAPABILITIES = Object.freeze([
  connectorCapability({
    operationId: 'get_product',
    supportState: 'BLOCKED_BY_ACCESS',
    limitations: [
      'Admin GraphQL Product/ProductVariant/media/bundle fields are E2 schema-reference known; exact merchant-authorized scope, real Product identity mapping and readback evidence require E3 provider-authentic execution against the isolated target.',
    ],
  }),
  connectorCapability({
    operationId: 'get_variant',
    supportState: 'BLOCKED_BY_ACCESS',
    limitations: [
      'ProductVariant option/SKU/price fields are E2 schema-reference known; stable providerVariantId behavior and real option-pair mapping require E3 execution evidence.',
    ],
  }),
  connectorCapability({
    operationId: 'get_inventory',
    supportState: 'BLOCKED_BY_ACCESS',
    limitations: [
      'InventoryLevel exposes multiple named quantity states via quantities(names:[...]) (for example available, on_hand, committed, incoming) rather than one raw number; which named state maps to normalized rawQuantity vs sellableQuantity is a real mapping decision that requires E3 execution/readback evidence, not assumption.',
    ],
  }),
  connectorCapability({
    operationId: 'get_order',
    supportState: 'BLOCKED_BY_ACCESS',
    limitations: [
      'The Order object is scoped to the last 60 days by default; older records require the merchant to grant read_all_orders (in addition to read_orders/write_orders). Real CompletenessScope (BOUNDED/PERMISSION_SCOPE vs TIME_WINDOW) cannot be claimed without E3 evidence of the exact granted access-scope set for the target store.',
    ],
  }),
  connectorCapability({
    operationId: 'get_fulfillment',
    supportState: 'UNKNOWN',
    limitations: ['No provider-authentic fulfillment mapping is admitted.'],
  }),
  connectorCapability({
    operationId: 'get_tracking',
    supportState: 'UNKNOWN',
    limitations: ['No provider-authentic shipment/tracking mapping is admitted.'],
  }),
  connectorCapability({
    operationId: 'process_webhook',
    supportState: 'BLOCKED_BY_ACCESS',
    limitations: [
      'Shopify webhook delivery/HMAC-verification and topic/version behavior require exact app-scoped secret and topic subscription evidence; no signature algorithm, payload schema or endpoint is guessed here.',
    ],
  }),
  connectorCapability({
    operationId: 'verify_customer_order_access',
    supportState: 'BLOCKED_BY_ACCESS',
    limitations: [
      'Customer-to-order authorization requires real order/customer identity readback under the isolated target; not admitted before E3 evidence.',
    ],
  }),
]);

export function createShopifyEvidenceGatedStub(input: {
  merchantWorkspaceId: MerchantWorkspaceId;
  integrationId: IntegrationId;
  now: () => UtcTimestamp;
}): EvidenceGatedCommerceConnectorStub {
  const identity: ConnectorIdentity = {
    provider: 'shopify',
    connectorVersion: 'v1-reference-staging-e2-evidence-gated',
    apiVersionState: 'EVIDENCE_REQUIRED',
    environment: 'STAGING',
    merchantWorkspaceId: input.merchantWorkspaceId,
    integrationId: input.integrationId,
  };
  return new EvidenceGatedCommerceConnectorStub(identity, SHOPIFY_STAGING_CAPABILITIES, input.now);
}
