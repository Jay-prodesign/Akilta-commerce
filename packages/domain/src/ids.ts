import { assertNonEmptyString, type Brand } from './brand';

export type InternalId<Name extends string> = Brand<string, `InternalId:${Name}`>;
export type ExternalId<Name extends string> = Brand<string, `ExternalId:${Name}`>;

export function internalId<Name extends string>(value: string, name: Name): InternalId<Name> {
  return assertNonEmptyString(value, name) as InternalId<Name>;
}

export function externalId<Name extends string>(value: string, name: Name): ExternalId<Name> {
  return assertNonEmptyString(value, name) as ExternalId<Name>;
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
export type CorrelationId = InternalId<'Correlation'>;
export type UsageEventId = InternalId<'UsageEvent'>;
export type EvaluationEventId = InternalId<'EvaluationEvent'>;
export type IdempotencyKey = Brand<string, 'IdempotencyKey'>;

export function idempotencyKey(value: string): IdempotencyKey {
  return assertNonEmptyString(value, 'IdempotencyKey') as IdempotencyKey;
}

export function agencyClientAssignmentId(value: string): AgencyClientAssignmentId {
  return internalId(value, 'AgencyClientAssignment');
}
