import { assertNonEmptyString, DomainPrimitiveError, type Brand } from './brand';
import type {
  AgencyClientAssignmentId,
  MembershipId,
  MerchantWorkspaceId,
  OrganizationId,
  UserId,
} from './ids';
import type { LocaleTag } from './locale';
import type { UtcTimestamp } from './time';

export const ORGANIZATION_TYPES = [
  'STANDALONE_MERCHANT',
  'AGENCY',
  'PLATFORM_INTERNAL',
] as const;

export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];
export type OperationalStatus = Brand<string, 'OperationalStatus'>;
export type TimezoneId = Brand<string, 'TimezoneId'>;
export type WorkspaceOnboardingState = Brand<string, 'WorkspaceOnboardingState'>;
export type ModuleKey = Brand<string, 'ModuleKey'>;

function assertIsOperationalStatus(value: string): asserts value is OperationalStatus {
  assertNonEmptyString(value, 'OperationalStatus');
}

function assertIsWorkspaceOnboardingState(value: string): asserts value is WorkspaceOnboardingState {
  assertNonEmptyString(value, 'WorkspaceOnboardingState');
}

function assertIsModuleKey(value: string): asserts value is ModuleKey {
  assertNonEmptyString(value, 'ModuleKey');
}

/** Re-runs the identical IANA timezone check on the exact value being returned. */
function assertIsTimezoneId(value: string): asserts value is TimezoneId {
  try {
    Intl.DateTimeFormat('en', { timeZone: value }).format(new Date(0));
  } catch {
    throw new DomainPrimitiveError('TimezoneId must be a valid IANA-style timezone identifier');
  }
}

export function operationalStatus(value: string): OperationalStatus {
  assertIsOperationalStatus(value);
  return value;
}

export function workspaceOnboardingState(value: string): WorkspaceOnboardingState {
  assertIsWorkspaceOnboardingState(value);
  return value;
}

export function moduleKey(value: string): ModuleKey {
  assertIsModuleKey(value);
  return value;
}

export function timezoneId(value: string): TimezoneId {
  const candidate = value.trim();
  if (candidate.length === 0) {
    throw new DomainPrimitiveError('TimezoneId must be non-empty');
  }
  assertIsTimezoneId(candidate);
  return candidate;
}

export interface Organization {
  readonly organizationId: OrganizationId;
  readonly type: OrganizationType;
  readonly displayName: string;
  readonly status: OperationalStatus;
  readonly createdAt: UtcTimestamp;
}

export interface MerchantWorkspace {
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly organizationId: OrganizationId;
  readonly displayName: string;
  readonly status: OperationalStatus;
  readonly localeDefault: LocaleTag;
  readonly timezone: TimezoneId;
  readonly onboardingState: WorkspaceOnboardingState;
  readonly securityPolicyRef?: string;
  readonly dataRegionPreference?: string;
}

export interface User {
  readonly userId: UserId;
  readonly status: OperationalStatus;
}

export interface Membership {
  readonly membershipId: MembershipId;
  readonly userId: UserId;
  readonly organizationId: OrganizationId;
  readonly roleRefs: readonly string[];
  readonly status: OperationalStatus;
  readonly validFrom?: UtcTimestamp;
  readonly validTo?: UtcTimestamp;
}

export interface AgencyClientAssignment {
  readonly assignmentId: AgencyClientAssignmentId;
  readonly agencyOrganizationId: OrganizationId;
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly allowedModules: readonly ModuleKey[];
  readonly permissionOverrideRefs: readonly string[];
  readonly approvalAuthorityRefs: readonly string[];
  readonly dataAccessLevel?: string;
  readonly status: OperationalStatus;
  readonly validFrom?: UtcTimestamp;
  readonly validTo?: UtcTimestamp;
  readonly reasonRef?: string;
}

export function assertValidityWindow(validFrom?: UtcTimestamp, validTo?: UtcTimestamp): void {
  if (validFrom && validTo && new Date(validFrom).getTime() > new Date(validTo).getTime()) {
    throw new DomainPrimitiveError('validFrom must be earlier than or equal to validTo');
  }
}

export function assertAgencyAssignmentInvariant(
  agency: Organization,
  assignment: AgencyClientAssignment,
): void {
  if (agency.type !== 'AGENCY') {
    throw new DomainPrimitiveError('AgencyClientAssignment requires an AGENCY organization');
  }
  if (agency.organizationId !== assignment.agencyOrganizationId) {
    throw new DomainPrimitiveError('AgencyClientAssignment agencyOrganizationId mismatch');
  }
  assertValidityWindow(assignment.validFrom, assignment.validTo);
}

export function isOperationallyActive(status: OperationalStatus): boolean {
  return status === 'ACTIVE';
}
