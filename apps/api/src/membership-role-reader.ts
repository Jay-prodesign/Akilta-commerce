import type { MembershipId } from '../../../packages/domain/src';
import type { MembershipRoleReadResult, MembershipRoleReader } from '../../../packages/authz/src';

/**
 * Provider-neutral query boundary this adapter depends on. It owns no connection pool, secrets,
 * migrations, or vendor initialization — those remain entirely outside this file's responsibility.
 * Any executor (a real pg pool wrapper, a test double, a future provider-neutral abstraction) that
 * can run one parameterized SQL query and return rows satisfies this contract.
 */
export interface MembershipRoleQueryExecutor {
  query(sql: string, params: readonly unknown[]): Promise<{ readonly rows: readonly Record<string, unknown>[] }>;
}

const SELECT_ROLE_KEYS_BY_MEMBERSHIP_ID = 'SELECT role_key FROM membership_roles WHERE membership_id = $1';

/**
 * The one authoritative runtime adapter for MembershipRoleReader: an exact, parameterized read of
 * membership_roles.role_key for a single membershipId. Row order carries no meaning — normalization
 * happens in packages/authz. Any query failure (connectivity, syntax, timeout) maps to READ_ERROR,
 * which the evaluator fails closed on; this adapter never invents a fallback role set.
 */
export function createMembershipRoleReader(executor: MembershipRoleQueryExecutor): MembershipRoleReader {
  return {
    async read(membershipId: MembershipId): Promise<MembershipRoleReadResult> {
      try {
        const result = await executor.query(SELECT_ROLE_KEYS_BY_MEMBERSHIP_ID, [membershipId]);
        const roleKeys = result.rows.map((row) => String(row.role_key));
        return { outcome: 'READ_SUCCESS', roleKeys };
      } catch {
        return { outcome: 'READ_ERROR' };
      }
    },
  };
}
