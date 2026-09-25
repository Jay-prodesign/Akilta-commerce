import type {
  AgencyClientAssignment,
  AgencyClientAssignmentId,
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
  readonly agencyAssignment?: AgencyClientAssignment;
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
        | 'MEMBERSHIP_INACTIVE'
        | 'MEMBERSHIP_NOT_YET_VALID'
        | 'MEMBERSHIP_EXPIRED'
        | 'ACTIVE_WORKSPACE_MISMATCH'
        | 'STANDALONE_ORGANIZATION_MISMATCH'
        | 'AGENCY_ASSIGNMENT_REQUIRED'
        | 'AGENCY_ASSIGNMENT_INACTIVE'
        | 'AGENCY_ASSIGNMENT_NOT_YET_VALID'
        | 'AGENCY_ASSIGNMENT_EXPIRED'
        | 'AGENCY_ASSIGNMENT_ORGANIZATION_MISMATCH'
        | 'AGENCY_ASSIGNMENT_WORKSPACE_MISMATCH'
        | 'AGENCY_MODULE_NOT_ALLOWED'
        | 'PLATFORM_INTERNAL_REQUIRES_PRIVILEGED_PATH'
        | 'PERMISSION_NOT_GRANTED';
    };
