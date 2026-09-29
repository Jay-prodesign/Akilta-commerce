import type {
  AgencyClientAssignment,
  AgencyClientAssignmentId,
  Membership,
  MembershipId,
  MerchantWorkspaceId,
  OrganizationId,
  OrganizationType,
  OperationalStatus,
  RequestId,
  RunId,
  UserId,
  LocaleTag,
  UtcTimestamp,
} from '../../domain/src';
import type { ErrorCode } from '../../domain/src/errors';
import type { Permission } from './permissions';

export type AuthChannel = 'web' | 'merchant_whatsapp' | 'internal';
export type AuthAssuranceLevel = 'LOW' | 'STANDARD' | 'STEP_UP' | 'STRONG';

export type ResourceScope =
  | {
      readonly kind: 'ORGANIZATION';
      readonly organizationId: OrganizationId;
    }
  | {
      readonly kind: 'MERCHANT_WORKSPACE';
      readonly merchantWorkspaceId: MerchantWorkspaceId;
    }
  | {
      readonly kind: 'RESOURCE';
      readonly merchantWorkspaceId: MerchantWorkspaceId;
      readonly resourceType: string;
      readonly resourceId: string;
    };

export interface PermissionGrant {
  readonly permission: Permission;
  readonly scope: ResourceScope;
  readonly sourceRef: string;
}

export interface ExecutionContext {
  readonly actorUserId: UserId;
  readonly actorOrganizationId: OrganizationId;
  readonly actorOrganizationType: OrganizationType;
  readonly membershipId: MembershipId;
  readonly membershipStatus: OperationalStatus;
  readonly membershipValidFrom?: UtcTimestamp;
  readonly membershipValidTo?: UtcTimestamp;
  readonly activeMerchantWorkspaceId: MerchantWorkspaceId | null;
  readonly agencyClientAssignmentId?: AgencyClientAssignmentId;
  readonly permissionSnapshotRef: string;
  readonly permissionGrants: readonly PermissionGrant[];
  readonly assuranceLevel: AuthAssuranceLevel;
  readonly channel: AuthChannel;
  readonly requestId: RequestId;
  readonly runId: RunId;
  readonly locale: LocaleTag;
  readonly occurredAt: UtcTimestamp;
}

/**
 * Must be built from server-side tenancy/resource lookup. Provider/model/client payloads
 * may name a resource but do not establish this binding.
 */
export interface ServerResolvedResourceContext {
  readonly owningOrganizationId: OrganizationId;
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly resourceType: string;
  readonly resourceId?: string;
}

export interface AuthorizationRequest {
  readonly executionContext: ExecutionContext;
  readonly requiredPermission: Permission;
  readonly target: ServerResolvedResourceContext;
  readonly module?: string;
  /**
   * Server-resolved Membership rows scoped to the caller's actor/organization; the evaluator
   * derives current authority from these at decision time and never trusts copied context fields.
   * Structurally required so a caller cannot compile without supplying the evidence envelope; an
   * empty/non-matching set can still only ever resolve to a deny, never a bypass.
   */
  readonly membershipCandidates: readonly Membership[];
  /**
   * Server-resolved AgencyClientAssignment rows scoped to the caller's actor organization + the
   * target merchant workspace. Structurally required — a non-AGENCY caller passes an explicit
   * empty array; a caller can no longer hand the evaluator a single pre-selected assignment object.
   */
  readonly agencyAssignmentCandidates: readonly AgencyClientAssignment[];
}

export type AuthorizationDecision =
  | {
      readonly decision: 'ALLOW';
      readonly matchedPermission: Permission;
      readonly matchedGrantSourceRef: string;
    }
  | {
      readonly decision: 'DENY';
      readonly code: Extract<ErrorCode, 'AUTH_TENANT_MISMATCH' | 'AUTH_PERMISSION_DENIED'>;
      readonly reason:
        | 'MEMBERSHIP_NOT_CURRENT'
        | 'MEMBERSHIP_CURRENT_CONFLICT'
        | 'MEMBERSHIP_IDENTITY_MISMATCH'
        | 'ACTIVE_WORKSPACE_MISMATCH'
        | 'STANDALONE_ORGANIZATION_MISMATCH'
        | 'AGENCY_ASSIGNMENT_NOT_CURRENT'
        | 'AGENCY_ASSIGNMENT_CURRENT_CONFLICT'
        | 'AGENCY_ASSIGNMENT_IDENTITY_MISMATCH'
        | 'AGENCY_MODULE_NOT_ALLOWED'
        | 'PLATFORM_INTERNAL_REQUIRES_PRIVILEGED_PATH'
        | 'PERMISSION_AUTHORITY_UNRESOLVED'
        | 'PERMISSION_AUTHORITY_STALE_REF'
        | 'PERMISSION_NOT_GRANTED';
    };
