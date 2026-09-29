import type { MembershipId, MerchantWorkspaceId } from '../../domain/src';
import { PERMISSIONS, type Permission } from './permissions';
import type { PermissionGrant } from './types';

export interface RolePermissionPolicy {
  readonly policyVersion: string;
  readonly grants: Readonly<Record<string, readonly Permission[]>>;
}

/**
 * Minimum-viable, versioned, server-owned role->Permission catalog. Every admitted Permission is
 * also its own role key, granting exactly itself. Bundling multiple permissions under named
 * business roles (e.g. "workspace-owner") is product content, not engineering architecture, and is
 * deliberately left to future, separately-selected work; this identity mapping keeps role
 * granularity maximally narrow (never over-grants) while still being a real versioned catalog that
 * proves the deterministic snapshot/authorityVersion mechanism this task is scoped to deliver.
 */
export const ROLE_PERMISSION_POLICY: RolePermissionPolicy = {
  policyVersion: 'v1',
  grants: Object.fromEntries(PERMISSIONS.map((p) => [p, [p]])),
};

export interface PermissionAuthoritySnapshot {
  readonly membershipId: MembershipId;
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  /** Deduplicated and sorted; row order/duplication at the source never changes this. */
  readonly roleKeys: readonly string[];
  readonly policyVersion: string;
  readonly effectiveGrants: readonly PermissionGrant[];
  readonly authorityVersion: string;
}

export type PermissionAuthorityResolution =
  | { readonly outcome: 'RESOLVED'; readonly snapshot: PermissionAuthoritySnapshot }
  | { readonly outcome: 'FAILED' };

function normalizeRoleKeys(roleKeys: readonly string[]): readonly string[] {
  return Array.from(new Set(roleKeys)).sort();
}

/** Deterministic derivation only: identical authoritative state always yields an identical value; no wall-clock, no randomness. */
function deriveAuthorityVersion(
  membershipId: MembershipId,
  merchantWorkspaceId: MerchantWorkspaceId,
  normalizedRoleKeys: readonly string[],
  policyVersion: string,
): string {
  return `${membershipId}|${merchantWorkspaceId}|${normalizedRoleKeys.join(',')}|${policyVersion}`;
}

/**
 * Pure, decision-time recomputation of current permission authority from the already-resolved
 * current Membership's role keys (never a stored/cached snapshot, never re-reads anything itself).
 * Fails closed — never falls back to any caller-copied grant — on empty or unrecognized role keys,
 * so a membership with zero or unknown roles can never fall through to an implicit grant.
 */
export function resolvePermissionAuthoritySnapshot(
  membershipId: MembershipId,
  merchantWorkspaceId: MerchantWorkspaceId,
  roleKeys: readonly string[],
  policy: RolePermissionPolicy,
): PermissionAuthorityResolution {
  const normalizedRoleKeys = normalizeRoleKeys(roleKeys);
  if (normalizedRoleKeys.length === 0) {
    return { outcome: 'FAILED' };
  }

  const permissionSet = new Set<Permission>();
  for (const roleKey of normalizedRoleKeys) {
    const rolePermissions = policy.grants[roleKey];
    if (rolePermissions === undefined) {
      return { outcome: 'FAILED' };
    }
    for (const grantedPermission of rolePermissions) {
      permissionSet.add(grantedPermission);
    }
  }

  const effectiveGrants: readonly PermissionGrant[] = Array.from(permissionSet)
    .sort()
    .map((grantedPermission) => ({
      permission: grantedPermission,
      scope: { kind: 'MERCHANT_WORKSPACE', merchantWorkspaceId } as const,
      sourceRef: `role-policy:${policy.policyVersion}`,
    }));

  const authorityVersion = deriveAuthorityVersion(membershipId, merchantWorkspaceId, normalizedRoleKeys, policy.policyVersion);

  return {
    outcome: 'RESOLVED',
    snapshot: {
      membershipId,
      merchantWorkspaceId,
      roleKeys: normalizedRoleKeys,
      policyVersion: policy.policyVersion,
      effectiveGrants,
      authorityVersion,
    },
  };
}
