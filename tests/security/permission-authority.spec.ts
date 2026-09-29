import {
  permission,
  resolveCurrentPermissionAuthority,
  resolvePermissionAuthoritySnapshot,
  ROLE_PERMISSION_POLICY,
  type MembershipRoleReadResult,
  type MembershipRoleReader,
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

function fakeReader(result: MembershipRoleReadResult): MembershipRoleReader {
  return { read: () => Promise.resolve(result) };
}

function readerWithRoles(...roleKeys: string[]): MembershipRoleReader {
  return fakeReader({ outcome: 'READ_SUCCESS', roleKeys });
}

const membershipId = internalId('perm-authority-membership-1', 'Membership');
const otherMembershipId = internalId('perm-authority-membership-2', 'Membership');
const workspaceId = internalId('perm-authority-ws-1', 'MerchantWorkspace');
const otherWorkspaceId = internalId('perm-authority-ws-2', 'MerchantWorkspace');

const cases: Array<{ id: string; run: () => void | Promise<void> }> = [
  {
    id: 'PERM-GEN-01-KNOWN-ROLE-GRANTS-EXACTLY-ITS-MAPPED-PERMISSIONS',
    run: () => {
      const resolution = resolvePermissionAuthoritySnapshot(
        membershipId,
        workspaceId,
        ['CLIENT_ANALYST'],
        ROLE_PERMISSION_POLICY,
      );
      assert(resolution.outcome === 'RESOLVED', 'a known role key must resolve');
      const { effectiveGrants } = resolution.snapshot;
      assert(effectiveGrants.length === 1, 'expected exactly one effective grant');
      assert(effectiveGrants[0]!.permission === permission('analytics:read'), 'wrong permission granted');
      assert(
        effectiveGrants[0]!.scope.kind === 'MERCHANT_WORKSPACE' &&
          effectiveGrants[0]!.scope.merchantWorkspaceId === workspaceId,
        'effective grant must be scoped to the exact requested workspace',
      );
    },
  },
  {
    id: 'PERM-GEN-06-A-SUCCESSFUL-EMPTY-ROLE-READ-RESOLVES-TO-ZERO-GRANTS-NOT-A-FAILURE',
    run: () => {
      const resolution = resolvePermissionAuthoritySnapshot(membershipId, workspaceId, [], ROLE_PERMISSION_POLICY);
      assert(
        resolution.outcome === 'RESOLVED' && resolution.snapshot.effectiveGrants.length === 0,
        'a successful read of zero current roles must resolve to a valid snapshot with an empty grant set, never a resolution failure',
      );
    },
  },
  {
    id: 'PERM-GEN-12-UNKNOWN-ROLE-KEY-FAILS-CLOSED-NO-PARTIAL-GRANT',
    run: () => {
      const resolution = resolvePermissionAuthoritySnapshot(
        membershipId,
        workspaceId,
        ['CLIENT_ANALYST', 'role-that-does-not-exist-in-the-policy'],
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
      const a = resolvePermissionAuthoritySnapshot(
        membershipId,
        workspaceId,
        ['CLIENT_SUPPORT_AGENT', 'CLIENT_ANALYST'],
        ROLE_PERMISSION_POLICY,
      );
      const b = resolvePermissionAuthoritySnapshot(
        membershipId,
        workspaceId,
        ['CLIENT_SUPPORT_AGENT', 'CLIENT_ANALYST'],
        ROLE_PERMISSION_POLICY,
      );
      assert(a.outcome === 'RESOLVED' && b.outcome === 'RESOLVED', 'both resolutions must succeed');
      assert(a.snapshot.authorityVersion === b.snapshot.authorityVersion, 'identical authoritative state must yield an identical authorityVersion');
    },
  },
  {
    id: 'PERM-GEN-08-ROLE-REMOVAL-CHANGES-AUTHORITY-VERSION-AND-INVALIDATES-OLD-REF',
    run: () => {
      const before = resolvePermissionAuthoritySnapshot(
        membershipId,
        workspaceId,
        ['CLIENT_SUPPORT_AGENT', 'CLIENT_ANALYST'],
        ROLE_PERMISSION_POLICY,
      );
      const afterRemoval = resolvePermissionAuthoritySnapshot(
        membershipId,
        workspaceId,
        ['CLIENT_SUPPORT_AGENT'],
        ROLE_PERMISSION_POLICY,
      );
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
      const v1 = resolvePermissionAuthoritySnapshot(membershipId, workspaceId, ['CLIENT_ANALYST'], ROLE_PERMISSION_POLICY);
      const bumpedPolicy: RolePermissionPolicy = { ...ROLE_PERMISSION_POLICY, policyVersion: 'v2' };
      const v2 = resolvePermissionAuthoritySnapshot(membershipId, workspaceId, ['CLIENT_ANALYST'], bumpedPolicy);
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
      const base = resolvePermissionAuthoritySnapshot(membershipId, workspaceId, ['CLIENT_ANALYST'], ROLE_PERMISSION_POLICY);
      const otherMembership = resolvePermissionAuthoritySnapshot(
        otherMembershipId,
        workspaceId,
        ['CLIENT_ANALYST'],
        ROLE_PERMISSION_POLICY,
      );
      const otherWorkspace = resolvePermissionAuthoritySnapshot(
        membershipId,
        otherWorkspaceId,
        ['CLIENT_ANALYST'],
        ROLE_PERMISSION_POLICY,
      );
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
      const roleKeys = ['CLIENT_SUPPORT_AGENT', 'CLIENT_ANALYST', 'CLIENT_MARKETING_MANAGER'];
      const withDuplicates = [...roleKeys, 'CLIENT_SUPPORT_AGENT', 'CLIENT_ANALYST'];
      const canonical = resolvePermissionAuthoritySnapshot(membershipId, workspaceId, roleKeys, ROLE_PERMISSION_POLICY);
      assert(canonical.outcome === 'RESOLVED', 'canonical resolution must succeed');

      let permutationCount = 0;
      for (const perm of permutations(withDuplicates)) {
        const resolution = resolvePermissionAuthoritySnapshot(membershipId, workspaceId, perm, ROLE_PERMISSION_POLICY);
        assert(resolution.outcome === 'RESOLVED', 'every permutation must resolve');
        assert(
          resolution.snapshot.authorityVersion === canonical.snapshot.authorityVersion,
          'role-key order and duplicate rows must never change the authorityVersion',
        );
        assert(
          resolution.snapshot.effectiveGrants.length === canonical.snapshot.effectiveGrants.length,
          'role-key order and duplicate rows must never change the effective grant set size',
        );
        permutationCount += 1;
      }
      assert(permutationCount === factorial(withDuplicates.length), 'every role-key permutation must be exercised');
    },
  },
  {
    id: 'F4-STRUCTURALLY-DIFFERENT-IDENTIFIERS-CANNOT-COLLIDE-UNDER-DELIMITER-LIKE-CHARACTERS',
    run: () => {
      // A naive `[a, b].join('|')` style ref would let 'a|b' (one role key) collide with
      // separate role keys 'a' and 'b'. The canonical JSON encoding must not permit this.
      const withPipeInOneKey = resolvePermissionAuthoritySnapshot(
        membershipId,
        workspaceId,
        ['CLIENT_SUPPORT_AGENT|CLIENT_ANALYST'],
        ROLE_PERMISSION_POLICY,
      );
      const withTwoSeparateKeys = resolvePermissionAuthoritySnapshot(
        membershipId,
        workspaceId,
        ['CLIENT_SUPPORT_AGENT', 'CLIENT_ANALYST'],
        ROLE_PERMISSION_POLICY,
      );
      // The single combined key is unknown to the policy, so it fails closed rather than
      // silently matching the two-role case.
      assert(withPipeInOneKey.outcome === 'FAILED', 'a delimiter-colliding unknown role key must fail closed');
      assert(withTwoSeparateKeys.outcome === 'RESOLVED', 'the genuine two-role case must still resolve normally');
    },
  },
  {
    id: 'READER-INTEGRATION-EXACT-MEMBERSHIP-ID-QUERY-PARAMETER',
    run: async () => {
      let queriedMembershipId: unknown;
      const reader: MembershipRoleReader = {
        read: (id) => {
          queriedMembershipId = id;
          return Promise.resolve({ outcome: 'READ_SUCCESS', roleKeys: ['CLIENT_ANALYST'] });
        },
      };
      const resolution = await resolveCurrentPermissionAuthority(reader, membershipId, workspaceId, ROLE_PERMISSION_POLICY);
      assert(resolution.outcome === 'RESOLVED', 'expected resolution to succeed');
      assert(queriedMembershipId === membershipId, 'reader must be queried with the exact resolved membershipId');
    },
  },
  {
    id: 'READER-INTEGRATION-SUCCESSFUL-EMPTY-ROW-SET-RESOLVES-TO-ZERO-GRANTS',
    run: async () => {
      const resolution = await resolveCurrentPermissionAuthority(
        readerWithRoles(),
        membershipId,
        workspaceId,
        ROLE_PERMISSION_POLICY,
      );
      assert(
        resolution.outcome === 'RESOLVED' && resolution.snapshot.effectiveGrants.length === 0,
        'a successful reader read with zero rows must resolve to zero grants, not a failure',
      );
    },
  },
  {
    id: 'READER-INTEGRATION-READ-ERROR-FAILS-CLOSED-NO-FALLBACK',
    run: async () => {
      const resolution = await resolveCurrentPermissionAuthority(
        fakeReader({ outcome: 'READ_ERROR' }),
        membershipId,
        workspaceId,
        ROLE_PERMISSION_POLICY,
      );
      assert(resolution.outcome === 'FAILED', 'a reader error must fail closed with no fallback role set');
    },
  },
  {
    id: 'READER-INTEGRATION-UNKNOWN-ROLE-FROM-READER-FAILS-CLOSED',
    run: async () => {
      const resolution = await resolveCurrentPermissionAuthority(
        readerWithRoles('SOME_UNEVIDENCED_ROLE'),
        membershipId,
        workspaceId,
        ROLE_PERMISSION_POLICY,
      );
      assert(resolution.outcome === 'FAILED', 'a role key the reader returns but the policy does not recognize must fail closed');
    },
  },
];

async function main() {
  for (const testCase of cases) {
    await testCase.run();
    console.log(`PASS ${testCase.id}`);
  }
  console.log(`PASS ${cases.length}/${cases.length} permission authority scenarios`);
}

void main();
