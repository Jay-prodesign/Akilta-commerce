import {
  idempotencyKey,
  internalId,
  utcTimestamp,
  type CorrelationId,
  type EventId,
  type FulfillmentId,
  type IntegrationId,
  type InventoryObservationId,
  type MerchantWorkspaceId,
  type OrderId,
  type ProductId,
  type ShipmentId,
  type VariantId,
} from '../../packages/domain/src';
import { productStatus, providerStatus, type Product, type Variant, type InventoryObservation, type Fulfillment, type Shipment } from '../../packages/commerce-contract/src';
import { shouldAdvanceMonotonicProjection, type OperationalEvent } from '../../packages/events/src/operational';
import type { AsyncEventEnvelope } from '../../packages/events/src/async-envelope';

const workspace = internalId('ws-source-time', 'MerchantWorkspace') as MerchantWorkspaceId;
const integration = internalId('int-source-time', 'Integration') as IntegrationId;
const observedAt = utcTimestamp('2026-08-08T08:00:00Z');

const product: Product = {
  productId: internalId('product-source-time', 'Product') as ProductId,
  merchantWorkspaceId: workspace,
  integrationId: integration,
  providerProductId: 'provider-product',
  title: 'No provider source time',
  status: productStatus('ACTIVE'),
  mediaRefs: [],
  observedAt,
};

const variant: Variant = {
  variantId: internalId('variant-source-time', 'Variant') as VariantId,
  productId: product.productId,
  integrationId: integration,
  providerVariantId: 'provider-variant',
  optionPairs: [],
  observedAt,
};

const inventory: InventoryObservation = {
  inventoryObservationId: internalId('inventory-source-time', 'InventoryObservation') as InventoryObservationId,
  variantId: variant.variantId,
  trackingState: 'UNKNOWN',
  providerAvailability: 'UNKNOWN',
  inventoryPolicy: 'UNKNOWN',
  freshnessState: 'UNKNOWN',
  derivedAvailability: 'UNKNOWN',
  derivationRuleRef: 'source-time-missing-v1',
  observedAt,
};

const orderId = internalId('order-source-time', 'Order') as OrderId;
const fulfillment: Fulfillment = {
  fulfillmentId: internalId('fulfillment-source-time', 'Fulfillment') as FulfillmentId,
  orderId,
  status: providerStatus('UNKNOWN'),
  observedAt,
};
const shipment: Shipment = {
  shipmentId: internalId('shipment-source-time', 'Shipment') as ShipmentId,
  orderId,
  status: providerStatus('UNKNOWN'),
  observedAt,
};

const event: OperationalEvent = {
  eventId: internalId('event-source-time', 'OperationalEvent') as EventId,
  merchantWorkspaceId: workspace,
  eventType: 'provider.status',
  source: 'provider-without-origin-time',
  observedAt,
  correlationId: internalId('corr-source-time', 'Correlation') as CorrelationId,
  idempotencyKey: idempotencyKey('idem-source-time'),
  processingState: 'RECEIVED',
};

const envelope: AsyncEventEnvelope = {
  schemaVersion: '1',
  topic: 'provider.status_reconcile',
  eventId: event.eventId,
  merchantWorkspaceId: workspace,
  integrationId: integration,
  source: event.source,
  observedAt,
  correlationId: event.correlationId,
  idempotencyKey: event.idempotencyKey,
  payloadType: 'provider.status',
  safePayloadRef: 'fixture:source-time-missing',
};

export const SOURCE_TIMESTAMP_PROVENANCE_SCENARIOS = [
  { id: 'SOURCE-TIME-PRODUCT-OPTIONAL', actual: product.sourceTimestamp, expected: undefined },
  { id: 'SOURCE-TIME-VARIANT-OPTIONAL', actual: variant.sourceTimestamp, expected: undefined },
  { id: 'SOURCE-TIME-INVENTORY-OPTIONAL', actual: inventory.sourceTimestamp, expected: undefined },
  { id: 'SOURCE-TIME-FULFILLMENT-OBSERVED-REQUIRED', actual: fulfillment.observedAt, expected: observedAt },
  { id: 'SOURCE-TIME-SHIPMENT-OBSERVED-REQUIRED', actual: shipment.observedAt, expected: observedAt },
  { id: 'SOURCE-TIME-EVENT-OPTIONAL', actual: event.sourceTimestamp, expected: undefined },
  { id: 'SOURCE-TIME-ASYNC-OPTIONAL', actual: envelope.sourceTimestamp, expected: undefined },
  { id: 'SOURCE-TIME-NO-INCOMING-NO-MONOTONIC-ADVANCE', actual: shouldAdvanceMonotonicProjection(utcTimestamp('2026-08-08T07:00:00Z'), undefined), expected: false },
  { id: 'SOURCE-TIME-NONE-BOTH-NO-MONOTONIC-ADVANCE', actual: shouldAdvanceMonotonicProjection(undefined, undefined), expected: false },
  { id: 'SOURCE-TIME-FIRST-KNOWN-CAN-ADVANCE', actual: shouldAdvanceMonotonicProjection(undefined, utcTimestamp('2026-08-08T07:00:00Z')), expected: true },
  { id: 'SOURCE-TIME-OLDER-CANNOT-REGRESS', actual: shouldAdvanceMonotonicProjection(utcTimestamp('2026-08-08T07:00:00Z'), utcTimestamp('2026-08-08T06:59:59Z')), expected: false },
  { id: 'SOURCE-TIME-NEWER-CAN-ADVANCE', actual: shouldAdvanceMonotonicProjection(utcTimestamp('2026-08-08T07:00:00Z'), utcTimestamp('2026-08-08T07:00:01Z')), expected: true },
  { id: 'SOURCE-TIME-MISSING-IMPLIES-UNKNOWN-FRESHNESS-IN-FIXTURE', actual: inventory.freshnessState, expected: 'UNKNOWN' },
] as const;

let pass = 0;
for (const scenario of SOURCE_TIMESTAMP_PROVENANCE_SCENARIOS) {
  if (Object.is(scenario.actual, scenario.expected)) pass += 1;
  else throw new Error(`${scenario.id}: expected ${String(scenario.expected)} got ${String(scenario.actual)}`);
}
console.log(`SOURCE_TIMESTAMP_PROVENANCE ${pass}/${SOURCE_TIMESTAMP_PROVENANCE_SCENARIOS.length} PASS`);
