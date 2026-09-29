import type { MembershipId, MerchantWorkspaceId } from '../../domain/src';
import { permission, type Permission } from './permissions';
import type { MembershipRoleReadResult, MembershipRoleReader, PermissionGrant } from './types';

export interface RolePermissionPolicy {
  readonly policyVersion: string;
  readonly grants: Readonly<Record<string, readonly Permission[]>>;
}

/**
 * Minimum directly-evidenced V1 subset of the canonical D-12 named-role model. Deliberately
 * partial and conservative: no complete role bundle or frozen machine role_key set exists yet, so
 * only role->Permission pairs whose semantics are directly supported by D-12 are admitted here.
 * Broader roles (Client Owner/Admin, Agency Owner/Operator, Platform Internal, Custom) are
 * intentionally left unmapped rather than approximated as "gets everything" — an unmapped role
 * fails closed. This closes permission-currentness mechanics only, not final RBAC bundle design.
 */
export const ROLE_PERMISSION_POLICY: RolePermissionPolicy = {
  policyVersion: 'v1',
  grants: {
    CLIENT_SUPPORT_AGENT: [
      permission('conversation:read'),
      permission('conversation:respond'),
      permission('conversation:assign'),
      permission('customer:read'),
      permission('commerce.order:read'),
    ],
    CLIENT_ANALYST: [permission('analytics:read')],
    // Still requires the existing current AgencyClientAssignment gate in evaluateAuthorization.
    AGENCY_ANALYST: [permission('analytics:read')],
    CLIENT_MARKETING_MANAGER: [permission('campaign:read'), permission('campaign:draft')],
  },
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

/**
 * Collision-safe: a canonical JSON encoding — explicit array/object structure with proper string
 * escaping via JSON.stringify — so no delimiter-concatenation ambiguity between structurally
 * different inputs (e.g. an identifier containing the join character a naive `join('|')` would use)
 * can collapse to the same value. Includes the deterministic effective-grant/scope representation,
 * not just role keys, per field in a fixed key order so equal inputs always serialize identically.
 * Deterministic only: no wall-clock, no randomness, no hashing (avoids a runtime-specific crypto
 * dependency; the JSON encoding alone is what provides collision-safety here).
 */
function deriveAuthorityVersion(
  membershipId: MembershipId,
  merchantWorkspaceId: MerchantWorkspaceId,
  normalizedRoleKeys: readonly string[],
  policyVersion: string,
  effectiveGrants: readonly PermissionGrant[],
): string {
  return JSON.stringify([
    membershipId,
    merchantWorkspaceId,
    normalizedRoleKeys,
    policyVersion,
    effectiveGrants.map((g) => [
      g.permission,
      g.scope.kind,
      g.scope.kind !== 'ORGANIZATION' ? g.scope.merchantWorkspaceId : null,
    ]),
  ]);
}

/**
 * Pure, deterministic derivation from already-obtained current role keys (never reads anything
 * itself). A successful read that returns zero roles is a valid current state — it resolves to a
 * snapshot with an empty effectiveGrants set, never a failure. Fails closed only when a role key is
 * not a recognized entry in the policy (unmapped/unknown role), never falling back to any
 * caller-copied grant. Exposed directly so normalization/versioning mechanics can be unit-tested
 * without an injected reader.
 */
export function resolvePermissionAuthoritySnapshot(
  membershipId: MembershipId,
  merchantWorkspaceId: MerchantWorkspaceId,
  roleKeys: readonly string[],
  policy: RolePermissionPolicy,
): PermissionAuthorityResolution {
  const normalizedRoleKeys = normalizeRoleKeys(roleKeys);

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

  const authorityVersion = deriveAuthorityVersion(
    membershipId,
    merchantWorkspaceId,
    normalizedRoleKeys,
    policy.policyVersion,
    effectiveGrants,
  );

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

/**
 * Decision-time entry point: reads current role keys for the exact resolved membershipId through
 * the server-owned MembershipRoleReader port, then derives the snapshot. A reader error fails
 * closed (FAILED) — never falls back to any caller-supplied Membership.roleRefs, copied
 * context.permissionGrants, or client/provider/model payload.
 */
export async function resolveCurrentPermissionAuthority(
  reader: MembershipRoleReader,
  membershipId: MembershipId,
  merchantWorkspaceId: MerchantWorkspaceId,
  policy: RolePermissionPolicy,
): Promise<PermissionAuthorityResolution> {
  const read: MembershipRoleReadResult = await reader.read(membershipId);
  if (read.outcome === 'READ_ERROR') {
    return { outcome: 'FAILED' };
  }
  return resolvePermissionAuthoritySnapshot(membershipId, merchantWorkspaceId, read.roleKeys, policy);
}
