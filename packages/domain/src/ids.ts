import { assertNonEmptyString, type Brand } from './brand';

export type InternalId<Name extends string> = Brand<string, `InternalId:${Name}`>;
export type ExternalId<Name extends string> = Brand<string, `ExternalId:${Name}`>;

/**
 * Name is not an arbitrary type parameter: it is the same literal the caller passes as `name` below,
 * which assertNonEmptyString also uses in its error message, so the claimed brand is anchored to the
 * actual runtime argument rather than freely chosen by the caller.
 */
function assertIsInternalId<Name extends string>(value: string, name: Name): asserts value is InternalId<Name> {
  assertNonEmptyString(value, name);
}

function assertIsExternalId<Name extends string>(value: string, name: Name): asserts value is ExternalId<Name> {
  assertNonEmptyString(value, name);
}

export function internalId<Name extends string>(value: string, name: Name): InternalId<Name> {
  assertIsInternalId(value, name);
  return value;
}

export function externalId<Name extends string>(value: string, name: Name): ExternalId<Name> {
  assertIsExternalId(value, name);
  return value;
}

export type OrganizationId = InternalId<'Organization'>;
export type MerchantWorkspaceId = InternalId<'MerchantWorkspace'>;
export type UserId = InternalId<'User'>;
export type UserIdentityId = InternalId<'UserIdentity'>;
export type MembershipId = InternalId<'Membership'>;
export type AgencyClientAssignmentId = InternalId<'AgencyClientAssignment'>;
export type IntegrationId = InternalId<'Integration'>;
export type CustomerId = InternalId<'Customer'>;
export type CustomerIdentityId = InternalId<'CustomerIdentity'>;
export type ConversationId = InternalId<'Conversation'>;
export type MessageId = InternalId<'Message'>;
export type ActionId = InternalId<'Action'>;
export type ActionPlanId = InternalId<'ActionPlan'>;
export type ApprovalRequestId = InternalId<'ApprovalRequest'>;
export type MerchantRuleId = InternalId<'MerchantRule'>;
export type MerchantRuleVersionId = InternalId<'MerchantRuleVersion'>;
export type KnowledgeSourceId = InternalId<'KnowledgeSource'>;
export type KnowledgeItemId = InternalId<'KnowledgeItem'>;
export type ApprovedFactSetId = InternalId<'ApprovedFactSet'>;
export type ProductId = InternalId<'Product'>;
export type VariantId = InternalId<'Variant'>;
export type InventoryObservationId = InternalId<'InventoryObservation'>;
export type OrderId = InternalId<'Order'>;
export type OrderLineId = InternalId<'OrderLine'>;
export type FulfillmentId = InternalId<'Fulfillment'>;
export type ShipmentId = InternalId<'Shipment'>;
export type TrackingEventId = InternalId<'TrackingEvent'>;
export type EventId = InternalId<'OperationalEvent'>;
export type AuditEventId = InternalId<'AuditEvent'>;
export type RequestId = InternalId<'Request'>;
export type RunId = InternalId<'Run'>;
export type JobId = InternalId<'Job'>;
export type QuotaReservationId = InternalId<'QuotaReservation'>;
export type OutboxId = InternalId<'Outbox'>;
export type CorrelationId = InternalId<'Correlation'>;
export type UsageEventId = InternalId<'UsageEvent'>;
export type EvaluationEventId = InternalId<'EvaluationEvent'>;
export type IdempotencyKey = Brand<string, 'IdempotencyKey'>;

function assertIsIdempotencyKey(value: string): asserts value is IdempotencyKey {
  assertNonEmptyString(value, 'IdempotencyKey');
}

export function idempotencyKey(value: string): IdempotencyKey {
  assertIsIdempotencyKey(value);
  return value;
}

export function agencyClientAssignmentId(value: string): AgencyClientAssignmentId {
  return internalId(value, 'AgencyClientAssignment');
}
