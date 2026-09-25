import { isOperationallyActive, validityWindowViolation } from '../../domain/src/tenancy';
import type { ResourceScope, AuthorizationDecision, AuthorizationRequest, PermissionGrant } from './types';

function deny(
  code: 'AUTH_TENANT_MISMATCH' | 'AUTH_PERMISSION_DENIED',
  reason: Extract<AuthorizationDecision, { decision: 'DENY' }>['reason'],
): AuthorizationDecision {
  return { decision: 'DENY', code, reason };
}

function grantMatchesTarget(grant: PermissionGrant, request: AuthorizationRequest): boolean {
  const { target } = request;
  const scope: ResourceScope = grant.scope;

  if (scope.kind === 'ORGANIZATION') {
    return scope.organizationId === target.owningOrganizationId;
  }

  if (scope.kind === 'MERCHANT_WORKSPACE') {
    return scope.merchantWorkspaceId === target.merchantWorkspaceId;
  }

  return (
    scope.merchantWorkspaceId === target.merchantWorkspaceId &&
    scope.resourceType === target.resourceType &&
    scope.resourceId === target.resourceId
  );
}

export function evaluateAuthorization(request: AuthorizationRequest): AuthorizationDecision {
  const { executionContext: context, target } = request;

  if (!isOperationallyActive(context.membershipStatus)) {
    return deny('AUTH_PERMISSION_DENIED', 'MEMBERSHIP_INACTIVE');
  }

  const membershipViolation = validityWindowViolation(
    context.occurredAt,
    context.membershipValidFrom,
    context.membershipValidTo,
  );
  if (membershipViolation === 'NOT_YET_VALID') {
    return deny('AUTH_PERMISSION_DENIED', 'MEMBERSHIP_NOT_YET_VALID');
  }
  if (membershipViolation === 'EXPIRED') {
    return deny('AUTH_PERMISSION_DENIED', 'MEMBERSHIP_EXPIRED');
  }

  if (
    context.activeMerchantWorkspaceId === null ||
    context.activeMerchantWorkspaceId !== target.merchantWorkspaceId
  ) {
    return deny('AUTH_TENANT_MISMATCH', 'ACTIVE_WORKSPACE_MISMATCH');
  }

  if (context.actorOrganizationType === 'STANDALONE_MERCHANT') {
    if (context.actorOrganizationId !== target.owningOrganizationId) {
      return deny('AUTH_TENANT_MISMATCH', 'STANDALONE_ORGANIZATION_MISMATCH');
    }
  } else if (context.actorOrganizationType === 'AGENCY') {
    const assignment = request.agencyAssignment;
    if (!assignment) {
      return deny('AUTH_TENANT_MISMATCH', 'AGENCY_ASSIGNMENT_REQUIRED');
    }
    if (!isOperationallyActive(assignment.status)) {
      return deny('AUTH_TENANT_MISMATCH', 'AGENCY_ASSIGNMENT_INACTIVE');
    }
    const assignmentViolation = validityWindowViolation(
      context.occurredAt,
      assignment.validFrom,
      assignment.validTo,
    );
    if (assignmentViolation === 'NOT_YET_VALID') {
      return deny('AUTH_TENANT_MISMATCH', 'AGENCY_ASSIGNMENT_NOT_YET_VALID');
    }
    if (assignmentViolation === 'EXPIRED') {
      return deny('AUTH_TENANT_MISMATCH', 'AGENCY_ASSIGNMENT_EXPIRED');
    }
    if (assignment.agencyOrganizationId !== context.actorOrganizationId) {
      return deny('AUTH_TENANT_MISMATCH', 'AGENCY_ASSIGNMENT_ORGANIZATION_MISMATCH');
    }
    if (assignment.merchantWorkspaceId !== target.merchantWorkspaceId) {
      return deny('AUTH_TENANT_MISMATCH', 'AGENCY_ASSIGNMENT_WORKSPACE_MISMATCH');
    }
    if (request.module && !assignment.allowedModules.some((module) => module === request.module)) {
      return deny('AUTH_PERMISSION_DENIED', 'AGENCY_MODULE_NOT_ALLOWED');
    }
  } else {
    // Platform-internal/customer-support access is intentionally a separate privileged path.
    // The ordinary merchant/agency evaluator never grants it implicitly.
    return deny('AUTH_PERMISSION_DENIED', 'PLATFORM_INTERNAL_REQUIRES_PRIVILEGED_PATH');
  }

  const grant = context.permissionGrants.find(
    (candidate) =>
      candidate.permission === request.requiredPermission && grantMatchesTarget(candidate, request),
  );

  if (!grant) {
    return deny('AUTH_PERMISSION_DENIED', 'PERMISSION_NOT_GRANTED');
  }

  return {
    decision: 'ALLOW',
    matchedPermission: request.requiredPermission,
    matchedGrantSourceRef: grant.sourceRef,
  };
}
