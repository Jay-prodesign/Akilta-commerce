import { assertNonEmptyString, type Brand } from '../../domain/src/brand';
import type {
  CustomerId,
  FulfillmentId,
  IntegrationId,
  MerchantWorkspaceId,
  Money,
  OrderId,
  OrderLineId,
  ProductId,
  ShipmentId,
  TrackingEventId,
  UtcTimestamp,
  VariantId,
} from '../../domain/src';

export type ProviderStatus = Brand<string, 'ProviderStatus'>;
export function providerStatus(value: string): ProviderStatus {
  return assertNonEmptyString(value, 'ProviderStatus') as ProviderStatus;
}

export type CompletenessScope =
  | {
      readonly kind: 'FULL_HISTORY';
      readonly evidenceRef: string;
    }
  | {
      readonly kind: 'BOUNDED';
      readonly reason: 'TIME_WINDOW' | 'PERMISSION_SCOPE' | 'PROVIDER_LIMIT' | 'OTHER';
      readonly windowStart?: UtcTimestamp;
      readonly windowEnd?: UtcTimestamp;
      readonly evidenceRef?: string;
    }
  | {
      readonly kind: 'UNKNOWN';
      readonly reason?: string;
    };

export function fullHistoryScope(evidenceRef: string): CompletenessScope {
  return { kind: 'FULL_HISTORY', evidenceRef: assertNonEmptyString(evidenceRef, 'evidenceRef') };
}

export function canClaimLifetimeComplete(scope: CompletenessScope): boolean {
  return scope.kind === 'FULL_HISTORY' && scope.evidenceRef.trim().length > 0;
}

export interface Order {
  readonly orderId: OrderId;
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly integrationId: IntegrationId;
  readonly providerOrderId: string;
  readonly displayOrderRef?: string;
  readonly customerId?: CustomerId;
  readonly providerCustomerRef?: string;
  readonly orderStatus: ProviderStatus;
  readonly paymentStatus?: ProviderStatus;
  readonly currency?: string;
  readonly totalMoney?: Money;
  readonly createdAtProvider: UtcTimestamp;
  readonly updatedAtProvider?: UtcTimestamp;
  readonly completenessScope: CompletenessScope;
}

export interface OrderLine {
  readonly orderLineId: OrderLineId;
  readonly orderId: OrderId;
  readonly providerLineId?: string;
  readonly productId?: ProductId;
  readonly variantId?: VariantId;
  readonly titleSnapshot: string;
  readonly quantity: bigint;
  readonly lineTotalMoney?: Money;
}

export interface Fulfillment {
  readonly fulfillmentId: FulfillmentId;
  readonly orderId: OrderId;
  readonly providerFulfillmentId?: string;
  readonly status: ProviderStatus;
  /** Provider/source-origin timestamp when explicitly supplied. */
  readonly sourceTimestamp?: UtcTimestamp;
  /** AI Commerce capture/read time. */
  readonly observedAt: UtcTimestamp;
}

export interface Shipment {
  readonly shipmentId: ShipmentId;
  readonly orderId: OrderId;
  readonly fulfillmentId?: FulfillmentId;
  readonly carrier?: string;
  readonly trackingNumberRef?: string;
  readonly trackingUrl?: string;
  readonly status: ProviderStatus;
  readonly shippedAt?: UtcTimestamp;
  readonly deliveredAt?: UtcTimestamp;
  /** Provider/source-origin timestamp when explicitly supplied. */
  readonly sourceTimestamp?: UtcTimestamp;
  /** AI Commerce capture/read time. */
  readonly observedAt: UtcTimestamp;
}

export interface TrackingEvent {
  readonly trackingEventId: TrackingEventId;
  readonly shipmentId: ShipmentId;
  readonly providerEventId?: string;
  readonly statusCode: string;
  readonly occurredAt: UtcTimestamp;
  readonly observedAt: UtcTimestamp;
  readonly locationSafeSummary?: string;
}
