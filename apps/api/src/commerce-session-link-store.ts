import {
  resolveSessionLinkTransition,
  type AuthProviderKey,
  type CommerceSessionLinkCandidate,
  type CommercePrincipalId,
  type ExternalAuthSubjectRef,
  type ExternalCommerceSessionLinkRef,
  type SessionLinkAuthoritativeRecord,
  type SessionLinkIdempotencyKey,
  type SessionLinkTransitionRequest,
  type SessionLinkTransitionResult,
} from '../../../packages/authz/src';
import { externalId, internalId, operationalStatus } from '../../../packages/domain/src';

/**
 * SC-02 persistence adapter for commerce session-link CAS transitions (XSESS-06). Same split and
 * same atomic-boundary technique as provider-store-binding-store.ts: `resolveSessionLinkTransition`
 * is unchanged and untouched by this file; this is only where an APPLIED decision gets durably
 * written, via a single `UPDATE ... WHERE generation = $n RETURNING *` (already atomic in
 * PostgreSQL on its own) or, for a link that has never existed yet, a conflict-free
 * `INSERT ... ON CONFLICT DO NOTHING RETURNING *`.
 *
 * `resolveSessionLinkTransition` itself has no explicit "no record yet" case — every one of its
 * operations (LINK/RELINK/UNLINK) is evaluated against a `SessionLinkAuthoritativeRecord` it treats
 * as already existing. This adapter bridges that by presenting a synthetic generation-0,
 * not-revoked baseline record when no row exists yet, so a first LINK is just an ordinary CAS
 * transition whose `expectedGeneration` must be exactly 0 — the same CAS discipline, not a special
 * case in the decision function itself.
 */

export interface CommerceSessionLinkQueryExecutor {
  query(sql: string, params: readonly unknown[]): Promise<{ readonly rows: readonly Record<string, unknown>[] }>;
}

export type CommerceSessionLinkPersistOutcome =
  | SessionLinkTransitionResult
  | { readonly status: 'RACE_LOST' }
  | { readonly status: 'STORE_ERROR' };

export type CommerceSessionLinkCandidateReadOutcome =
  | { readonly status: 'FOUND'; readonly candidates: readonly CommerceSessionLinkCandidate[] }
  | { readonly status: 'STORE_ERROR' };

const SELECT_CURRENT =
  'SELECT generation, revoked FROM commerce_session_links WHERE principal_id = $1 AND external_link_ref = $2';

const SELECT_CANDIDATES_BY_FEDERATED_SUBJECT = `
  SELECT principal_id, external_link_ref, generation, revoked
  FROM commerce_session_links
  WHERE issuer_auth_provider = $1 AND external_subject_ref = $2
`;

const INSERT_FIRST_LINK = `
  INSERT INTO commerce_session_links
    (commerce_session_link_id, principal_id, external_link_ref, generation, revoked, created_at, updated_at)
  VALUES ($1, $2, $3, 1, $4, now(), now())
  ON CONFLICT (principal_id, external_link_ref) DO NOTHING
  RETURNING generation, revoked
`;

const UPDATE_CAS = `
  UPDATE commerce_session_links
  SET generation = $1, revoked = $2, updated_at = now()
  WHERE principal_id = $3 AND external_link_ref = $4 AND generation = $5
  RETURNING generation, revoked
`;

function baselineRecord(
  principalId: CommercePrincipalId,
  linkRef: ExternalCommerceSessionLinkRef,
): SessionLinkAuthoritativeRecord {
  return { ownerPrincipalId: principalId, ownerLinkRef: linkRef, state: { generation: 0, revoked: false } };
}

export interface CommerceSessionLinkStore {
  applyTransition(
    request: SessionLinkTransitionRequest,
    appliedIdempotencyKeys: ReadonlyMap<SessionLinkIdempotencyKey, SessionLinkAuthoritativeRecord>,
  ): Promise<CommerceSessionLinkPersistOutcome>;
  /**
   * Real candidate lookup for `resolveCommerceSessionLinkCandidate` (XSESS-02): every row whose
   * `issuer_auth_provider`/`external_subject_ref` exactly match the claimed federated identity.
   * Deliberately returns the raw row set rather than pre-resolving to one candidate here — the
   * exact-match/conflict/inactive decision stays exclusively in the pure resolver, never duplicated
   * in this adapter. In practice at most one row can ever match, enforced by this migration's own
   * `commerce_session_links_federated_subject_idx` partial unique index, but this read does not rely
   * on that constraint alone — the pure resolver's own `>1 match -> LINK_CONFLICT` handling is the
   * actual, defense-in-depth source of truth.
   */
  findFederatedCandidates(
    issuerAuthProvider: AuthProviderKey,
    externalSubjectRef: ExternalAuthSubjectRef,
  ): Promise<CommerceSessionLinkCandidateReadOutcome>;
}

export function createCommerceSessionLinkStore(
  executor: CommerceSessionLinkQueryExecutor,
): CommerceSessionLinkStore {
  return {
    async findFederatedCandidates(issuerAuthProvider, externalSubjectRef) {
      try {
        const readResult = await executor.query(SELECT_CANDIDATES_BY_FEDERATED_SUBJECT, [
          issuerAuthProvider,
          externalSubjectRef,
        ]);
        const candidates: CommerceSessionLinkCandidate[] = readResult.rows.map((row) => ({
          principalId: internalId(String(row.principal_id), 'User'),
          issuerAuthProvider,
          externalSubjectRef,
          externalLinkRef: externalId(String(row.external_link_ref), 'CommerceSessionLink'),
          status: operationalStatus(Boolean(row.revoked) ? 'REVOKED' : 'ACTIVE'),
        }));
        return { status: 'FOUND', candidates };
      } catch {
        return { status: 'STORE_ERROR' };
      }
    },
    async applyTransition(request, appliedIdempotencyKeys) {
      let currentRecord: SessionLinkAuthoritativeRecord;
      let rowExisted: boolean;
      try {
        const readResult = await executor.query(SELECT_CURRENT, [request.principalId, request.linkRef]);
        const row = readResult.rows[0];
        rowExisted = Boolean(row);
        currentRecord = row
          ? {
              ownerPrincipalId: request.principalId,
              ownerLinkRef: request.linkRef,
              state: { generation: Number(row.generation), revoked: Boolean(row.revoked) },
            }
          : baselineRecord(request.principalId, request.linkRef);
      } catch {
        return { status: 'STORE_ERROR' };
      }

      const decision = resolveSessionLinkTransition(request, currentRecord, appliedIdempotencyKeys);
      if (decision.status !== 'APPLIED') {
        return decision;
      }

      try {
        if (!rowExisted) {
          const insertResult = await executor.query(INSERT_FIRST_LINK, [
            crypto.randomUUID(),
            request.principalId,
            request.linkRef,
            decision.resultingRecord.state.revoked,
          ]);
          if (insertResult.rows.length === 0) {
            return { status: 'RACE_LOST' };
          }
          return decision;
        }

        const updateResult = await executor.query(UPDATE_CAS, [
          decision.resultingRecord.state.generation,
          decision.resultingRecord.state.revoked,
          request.principalId,
          request.linkRef,
          currentRecord.state.generation,
        ]);
        if (updateResult.rows.length === 0) {
          return { status: 'RACE_LOST' };
        }
        return decision;
      } catch {
        return { status: 'STORE_ERROR' };
      }
    },
  };
}
