import {
  internalId,
  utcTimestamp,
  CUSTOMER_VERIFICATION_LEVELS,
  DomainPrimitiveError,
  type CustomerId,
  type CustomerVerificationLevel,
  type MerchantWorkspaceId,
  type UtcTimestamp,
} from '../../../packages/domain/src';

/**
 * AC-CCIA-001 ("customer.context" Control Center read operation) persistence adapter. Reads the
 * already-persisted `customers` row and its linked `customer_identities` rows for one workspace-
 * scoped customer. This is a plain composite read, not a decision: nothing here grants access,
 * verifies a customer, or authorizes order disclosure — `authorizeCustomerOrderAccess`
 * (packages/domain/src/customer-identity.ts) remains the one function that decides whether a
 * specific order may be disclosed to a specific caller, and is not duplicated or widened by this
 * unit.
 *
 * CLAIM CEILING: deliberately returns only identity/verification-state fields (channel, level,
 * expiry, status) per linked identity — never raw `normalized_identifier_ref`/
 * `provider_identifier_ref` strings or `match_evidence_ref`, and never any order data. Exposing raw
 * identifiers or order history through this endpoint is a separate, not-yet-selected disclosure-
 * policy decision this unit does not self-invent.
 */

export interface CustomerContextQueryExecutor {
  query(sql: string, params: readonly unknown[]): Promise<{ readonly rows: readonly Record<string, unknown>[] }>;
}

const SELECT_CUSTOMER =
  'SELECT customer_id, safe_display_name, status FROM customers WHERE customer_id = $1 AND merchant_workspace_id = $2';

const SELECT_IDENTITIES = `
  SELECT channel_type, verification_level, verification_expires_at, status
  FROM customer_identities
  WHERE customer_id = $1 AND merchant_workspace_id = $2
  ORDER BY channel_type
`;

export interface CustomerContextIdentitySummary {
  readonly channelType: string;
  readonly verificationLevel: CustomerVerificationLevel;
  readonly verificationExpiresAt?: UtcTimestamp;
  readonly status: string;
}

export interface CustomerContext {
  readonly customerId: CustomerId;
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly safeDisplayName?: string;
  readonly status: string;
  readonly identities: readonly CustomerContextIdentitySummary[];
}

export type CustomerContextReadOutcome =
  | { readonly status: 'FOUND'; readonly context: CustomerContext }
  | { readonly status: 'NOT_FOUND' }
  | { readonly status: 'STORE_ERROR' };

function assertIsCustomerVerificationLevel(value: string): asserts value is CustomerVerificationLevel {
  if (!(CUSTOMER_VERIFICATION_LEVELS as readonly string[]).includes(value)) {
    throw new DomainPrimitiveError(`Unrecognized verification_level from store: ${value}`);
  }
}

function parseVerificationLevel(value: unknown): CustomerVerificationLevel {
  const candidate = String(value);
  assertIsCustomerVerificationLevel(candidate);
  return candidate;
}

function rowToIdentitySummary(row: Record<string, unknown>): CustomerContextIdentitySummary {
  const rawExpiresAt = row.verification_expires_at;
  // A real `pg` driver parses timestamptz columns into native Date instances, not strings — this
  // must accept both, or a real, non-null expiry would be silently dropped from the response.
  const expiresAt =
    typeof rawExpiresAt === 'string' || rawExpiresAt instanceof Date ? utcTimestamp(rawExpiresAt) : undefined;
  return {
    channelType: String(row.channel_type),
    verificationLevel: parseVerificationLevel(row.verification_level),
    ...(expiresAt !== undefined ? { verificationExpiresAt: expiresAt } : {}),
    status: String(row.status),
  };
}

export interface CustomerContextStore {
  readContext(customerId: CustomerId, merchantWorkspaceId: MerchantWorkspaceId): Promise<CustomerContextReadOutcome>;
}

export function createCustomerContextStore(executor: CustomerContextQueryExecutor): CustomerContextStore {
  return {
    async readContext(customerId, merchantWorkspaceId) {
      let customerRow: Record<string, unknown> | undefined;
      let identityRows: readonly Record<string, unknown>[];
      try {
        // Neither read depends on the other's result (both are scoped by the same
        // customerId/merchantWorkspaceId), so they run concurrently rather than paying two
        // sequential round trips.
        const [customerResult, identitiesResult] = await Promise.all([
          executor.query(SELECT_CUSTOMER, [customerId, merchantWorkspaceId]),
          executor.query(SELECT_IDENTITIES, [customerId, merchantWorkspaceId]),
        ]);
        customerRow = customerResult.rows[0];
        identityRows = identitiesResult.rows;
      } catch {
        return { status: 'STORE_ERROR' };
      }

      if (!customerRow) return { status: 'NOT_FOUND' };

      let identities: readonly CustomerContextIdentitySummary[];
      try {
        identities = identityRows.map(rowToIdentitySummary);
      } catch {
        return { status: 'STORE_ERROR' };
      }

      return {
        status: 'FOUND',
        context: {
          customerId: internalId(String(customerRow.customer_id), 'Customer'),
          merchantWorkspaceId,
          ...(typeof customerRow.safe_display_name === 'string' ? { safeDisplayName: customerRow.safe_display_name } : {}),
          status: String(customerRow.status),
          identities,
        },
      };
    },
  };
}
