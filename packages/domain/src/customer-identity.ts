import type {
  CustomerId,
  CustomerIdentityId,
  MerchantWorkspaceId,
} from './ids';
import type { UtcTimestamp } from './time';

export const CUSTOMER_VERIFICATION_LEVELS = ['CV0', 'CV1', 'CV2', 'CV3'] as const;
export type CustomerVerificationLevel = (typeof CUSTOMER_VERIFICATION_LEVELS)[number];

export interface CustomerIdentity {
  readonly customerIdentityId: CustomerIdentityId;
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly channelType: string;
  readonly normalizedIdentifierRef: string;
  readonly providerIdentifierRef?: string;
  readonly customerId?: CustomerId;
  readonly verificationLevel: CustomerVerificationLevel;
  readonly verificationExpiresAt?: UtcTimestamp;
  readonly matchEvidenceRef?: string;
  readonly status: string;
}

export type CustomerDisclosureClass =
  | 'PUBLIC_ONLY'
  | 'MINIMAL_ORDER_STATUS'
  | 'BOUNDED_ORDER_DETAIL'
  | 'SENSITIVE_CUSTOMER_ACTION';

const disclosureRank: Record<CustomerDisclosureClass, number> = {
  PUBLIC_ONLY: 0,
  MINIMAL_ORDER_STATUS: 1,
  BOUNDED_ORDER_DETAIL: 2,
  SENSITIVE_CUSTOMER_ACTION: 3,
};

const verificationRank: Record<CustomerVerificationLevel, number> = {
  CV0: 0,
  CV1: 1,
  CV2: 2,
  CV3: 3,
};

export function canDiscloseAtLevel(
  level: CustomerVerificationLevel,
  disclosureClass: CustomerDisclosureClass,
): boolean {
  return verificationRank[level] >= disclosureRank[disclosureClass];
}

export interface CustomerOrderAccessTarget {
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly customerId?: CustomerId;
}

export type CustomerOrderAccessDecision =
  | { readonly decision: 'ALLOW' }
  | {
      readonly decision: 'DENY';
      readonly reason:
        | 'WRONG_MERCHANT'
        | 'IDENTITY_NOT_CUSTOMER_BOUND'
        | 'ORDER_CUSTOMER_UNKNOWN'
        | 'CUSTOMER_MISMATCH'
        | 'VERIFICATION_INSUFFICIENT'
        | 'VERIFICATION_EXPIRED';
    };

export function authorizeCustomerOrderAccess(input: {
  readonly identity: CustomerIdentity;
  readonly target: CustomerOrderAccessTarget;
  readonly requiredDisclosure: CustomerDisclosureClass;
  readonly now: UtcTimestamp;
}): CustomerOrderAccessDecision {
  const { identity, target } = input;
  if (identity.merchantWorkspaceId !== target.merchantWorkspaceId) {
    return { decision: 'DENY', reason: 'WRONG_MERCHANT' };
  }
  if (!identity.customerId) return { decision: 'DENY', reason: 'IDENTITY_NOT_CUSTOMER_BOUND' };
  if (!target.customerId) return { decision: 'DENY', reason: 'ORDER_CUSTOMER_UNKNOWN' };
  if (identity.customerId !== target.customerId) return { decision: 'DENY', reason: 'CUSTOMER_MISMATCH' };
  if (
    identity.verificationExpiresAt &&
    new Date(input.now).getTime() >= new Date(identity.verificationExpiresAt).getTime()
  ) {
    return { decision: 'DENY', reason: 'VERIFICATION_EXPIRED' };
  }
  if (!canDiscloseAtLevel(identity.verificationLevel, input.requiredDisclosure)) {
    return { decision: 'DENY', reason: 'VERIFICATION_INSUFFICIENT' };
  }
  return { decision: 'ALLOW' };
}
