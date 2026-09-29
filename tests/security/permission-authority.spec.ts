import {
  permission,
  resolvePermissionAuthoritySnapshot,
  ROLE_PERMISSION_POLICY,
  type RolePermissionPolicy,
} from '../../packages/authz/src';
import { internalId } from '../../packages/domain/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function factorial(n: number): number {
  let result = 1;
  for (let i = 2; i <= n; i += 1) {
    result *= i;
  }
  return result;
}

/** Dependency-free exact permutation witness; used to prove resolver outcomes are order-independent. */
function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) {
    return [items.slice()];
  }
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += 1) {
    const current = items[i];
    if (current === undefined) continue;
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const restPermutation of permutations(rest)) {
      result.push([current, ...restPermutation]);
    }
  }
  return result;
}

const membershipId = internalId('perm-authority-membership-1', 'Membership');
const workspaceId = internalId('perm-authority-ws-1', 'MerchantWorkspace');
const otherWorkspaceId = internalId('perm-authority-ws-2', 'MerchantWorkspace');
const readRole = permission('commerce.product:read');
const refundRole = permission('commerce.order:refund');

const cases: Array<{ id: string; run: () => void }> = [
  {
    id: 'PERM-GEN-01-KNOWN-ROLE-GRANTS-EXACTLY-ITS-PERMISSION',
    run: () => {
      const resolution = resolvePermissionAuthoritySnapshot(membershipId, workspaceId, [readRole], ROLE_PERMISSION_POLICY);
      assert(resolution.outcome === 'RESOLVED', 'a known role key must resolve');
      const { effectiveGrants } = resolution.snapshot;
      assert(effectiveGrants.length === 1, 'expected exactly one effective grant');
      assert(effectiveGrants[0]!.permission === readRole, 'wrong permission granted');
      assert(
        effectiveGrants[0]!.scope.kind === 'MERCHANT_WORKSPACE' &&
          effectiveGrants[0]!.scope.merchantWorkspaceId === workspaceId,
        'effective grant must be scoped to the exact requested workspace',
      );
    },
  },
  {
    id: 'PERM-GEN-06-EMPTY-ROLE-KEYS-FAILS-CLOSED',
    run: () => {
      const resolution = resolvePermissionAuthoritySnapshot(membershipId, workspaceId, [], ROLE_PERMISSION_POLICY);
      assert(resolution.outcome === 'FAILED', 'zero role keys must fail closed, never resolve to an empty-but-valid snapshot');
    },
  },
  {
    id: 'PERM-GEN-12-UNKNOWN-ROLE-KEY-FAILS-CLOSED-NO-PARTIAL-GRANT',
    run: () => {
      const resolution = resolvePermissionAuthoritySnapshot(
        membershipId,
        workspaceId,
        [readRole, 'role-that-does-not-exist-in-the-policy'],
        ROLE_PERMISSION_POLICY,
      );
      assert(
        resolution.outcome === 'FAILED',
        'an unrecognized role key must fail the whole resolution closed, never silently grant only the known roles',
      );
    },
  },
  {
    id: 'PERM-GEN-07-IDENTICAL-STATE-YIELDS-IDENTICAL-AUTHORITY-VERSION',
    run: () => {
      const a = resolvePermissionAuthoritySnapshot(membershipId, workspaceId, [readRole, refundRole], ROLE_PERMISSION_POLICY);
      const b = resolvePermissionAuthoritySnapshot(membershipId, workspaceId, [readRole, refundRole], ROLE_PERMISSION_POLICY);
      assert(a.outcome === 'RESOLVED' && b.outcome === 'RESOLVED', 'both resolutions must succeed');
      assert(a.snapshot.authorityVersion === b.snapshot.authorityVersion, 'identical authoritative state must yield an identical authorityVersion');
    },
  },
  {
    id: 'PERM-GEN-08-ROLE-REMOVAL-CHANGES-AUTHORITY-VERSION-AND-INVALIDATES-OLD-REF',
    run: () => {
      const before = resolvePermissionAuthoritySnapshot(membershipId, workspaceId, [readRole, refundRole], ROLE_PERMISSION_POLICY);
      const afterRemoval = resolvePermissionAuthoritySnapshot(membershipId, workspaceId, [readRole], ROLE_PERMISSION_POLICY);
      assert(before.outcome === 'RESOLVED' && afterRemoval.outcome === 'RESOLVED', 'both resolutions must succeed');
      assert(
        before.snapshot.authorityVersion !== afterRemoval.snapshot.authorityVersion,
        'removing a role must change the authorityVersion',
      );
    },
  },
  {
    id: 'PERM-GEN-09-POLICY-VERSION-CHANGE-CHANGES-AUTHORITY-VERSION-EVEN-WITH-UNCHANGED-ROLES',
    run: () => {
      const v1 = resolvePermissionAuthoritySnapshot(membershipId, workspaceId, [readRole], ROLE_PERMISSION_POLICY);
      const bumpedPolicy: RolePermissionPolicy = { ...ROLE_PERMISSION_POLICY, policyVersion: 'v2' };
      const v2 = resolvePermissionAuthoritySnapshot(membershipId, workspaceId, [readRole], bumpedPolicy);
      assert(v1.outcome === 'RESOLVED' && v2.outcome === 'RESOLVED', 'both resolutions must succeed');
      assert(
        v1.snapshot.authorityVersion !== v2.snapshot.authorityVersion,
        'a policyVersion change must change the authorityVersion even with identical role keys',
      );
    },
  },
  {
    id: 'PERM-GEN-03-04-DIFFERENT-MEMBERSHIP-OR-WORKSPACE-NEVER-SHARES-AN-AUTHORITY-VERSION',
    run: () => {
      const base = resolvePermissionAuthoritySnapshot(membershipId, workspaceId, [readRole], ROLE_PERMISSION_POLICY);
      const otherMembership = resolvePermissionAuthoritySnapshot(
        internalId('perm-authority-membership-2', 'Membership'),
        workspaceId,
        [readRole],
        ROLE_PERMISSION_POLICY,
      );
      const otherWorkspace = resolvePermissionAuthoritySnapshot(membershipId, otherWorkspaceId, [readRole], ROLE_PERMISSION_POLICY);
      assert(
        base.outcome === 'RESOLVED' && otherMembership.outcome === 'RESOLVED' && otherWorkspace.outcome === 'RESOLVED',
        'all three resolutions must succeed',
      );
      assert(
        base.snapshot.authorityVersion !== otherMembership.snapshot.authorityVersion,
        'a snapshot bound to a different membership must never share an authorityVersion',
      );
      assert(
        base.snapshot.authorityVersion !== otherWorkspace.snapshot.authorityVersion,
        'a snapshot bound to a different workspace must never share an authorityVersion',
      );
    },
  },
  {
    id: 'PERM-GEN-11-ROLE-ORDER-AND-DUPLICATE-INVARIANCE',
    run: () => {
      const roleKeys = [readRole, refundRole, permission('conversation:respond')];
      const withDuplicates = [...roleKeys, readRole, refundRole];
      const canonical = resolvePermissionAuthoritySnapshot(membershipId, workspaceId, roleKeys, ROLE_PERMISSION_POLICY);
      assert(canonical.outcome === 'RESOLVED', 'canonical resolution must succeed');

      let permutationCount = 0;
      for (const permutation of permutations(withDuplicates)) {
        const resolution = resolvePermissionAuthoritySnapshot(membershipId, workspaceId, permutation, ROLE_PERMISSION_POLICY);
        assert(resolution.outcome === 'RESOLVED', 'every permutation must resolve');
        assert(
          resolution.snapshot.authorityVersion === canonical.snapshot.authorityVersion,
          'role-key order and duplicate rows must never change the authorityVersion',
        );
        assert(
          resolution.snapshot.effectiveGrants.length === canonical.snapshot.effectiveGrants.length,
          'role-key order and duplicate rows must never change the effective grant set size',
        );
        const canonicalPermissions = new Set(canonical.snapshot.effectiveGrants.map((g) => g.permission));
        for (const grantedPermission of resolution.snapshot.effectiveGrants.map((g) => g.permission)) {
          assert(canonicalPermissions.has(grantedPermission), 'permutation produced a grant not in the canonical effective set');
        }
        permutationCount += 1;
      }
      assert(permutationCount === factorial(withDuplicates.length), 'every role-key permutation must be exercised');
    },
  },
];

for (const testCase of cases) {
  testCase.run();
  console.log(`PASS ${testCase.id}`);
}

console.log(`PASS ${cases.length}/${cases.length} permission authority scenarios`);
