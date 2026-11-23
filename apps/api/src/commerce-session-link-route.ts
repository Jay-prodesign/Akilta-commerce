import { Hono, type Context } from 'hono';

import {
  authProviderKey,
  evaluateFederatedExchangeAdmission,
  externalAuthSubjectRef,
  federatedExchangeAudience,
  federatedExchangeNonce,
  federatedExchangePurpose,
  resolveCommerceSessionLinkCandidate,
  sessionLinkIdempotencyKey,
  type FederatedExchangeEnvelope,
  type FederatedExchangePolicy,
  type SessionLinkAuthoritativeRecord,
  type SessionLinkIdempotencyKey,
  type SessionLinkOperationKind,
} from '../../../packages/authz/src';
import { internalId, utcTimestamp } from '../../../packages/domain/src';
import { readUnknownBodyField } from './transport-contracts';
import type { CommerceSessionLinkStore } from './commerce-session-link-store';

/**
 * AC-XSESSION-107 (XSESS-01/02/06) — first real HTTP wiring of the federated-exchange -> commerce
 * session-link pipeline: `evaluateFederatedExchangeAdmission` (admit the AKILTA-side envelope) ->
 * `resolveCommerceSessionLinkCandidate` (resolve the admitted exchange's claimed federated identity
 * to exactly one existing `commerce_session_links` row, via `CommerceSessionLinkStore.
 * findFederatedCandidates`) -> `CommerceSessionLinkStore.applyTransition` (CAS-transition that
 * resolved row). This closes the canonical PROMISE_TRACE P-001 blocking_gap ("D-106 link/session
 * generations not yet closed") for the revalidate/rotate/revoke case these pure functions actually
 * support.
 *
 * Deliberately NOT a Control Center operation and does not use `evaluateAuthorization`/
 * `ExecutionContext` at all: this route is the pre-session, cross-project trust boundary itself
 * (AKILTA presenting a federated identity to establish/rotate/revoke an AI-Commerce session link),
 * not an authenticated merchant-side action. Composing it this way is explicitly sanctioned as
 * routine engineering (CLAUDE.md "Full autonomous execution directive", 2026-11-23): the missing
 * HTTP contract shape was not specified by any canonical document, so this route designs it,
 * consistent with the D-090 invariants and the already-approved architecture.
 *
 * Three boundaries are deliberately deferred, stated precisely rather than silently assumed, same
 * discipline as every other route built this session:
 *  1. **Envelope authenticity.** Nothing in `evaluateFederatedExchangeAdmission` or this route
 *     cryptographically verifies that `authProvider`/`externalSubjectRef` actually came from AKILTA
 *     — exactly as `resolveAuthenticatedPrincipal` (auth-identity.ts) and every other "exact-match on
 *     an already-verified claim" primitive in this codebase does not itself perform signature
 *     verification either. A real deployment needs an upstream step (HMAC/signature check against a
 *     shared AKILTA-side credential) before this route's own checks run; building that is a
 *     credential/security-authority decision (a genuine Founder Gate per AGENTS.md), not performed
 *     here. Until it exists, this endpoint must never be exposed to untrusted callers in a real
 *     deployment — it is wired and tested in isolation only.
 *  2. **Nonce replay ledger.** `consumedNonces` is accepted as an injected, always-empty-in-production
 *     `ReadonlySet` (same substrate-as-plain-evidence choice `federated-exchange-admission.ts`'s own
 *     doc comment specifies), not backed by a durable store yet. The shared `idempotency-ledger-
 *     store.ts` is NOT reused for this: its schema requires a NOT NULL, FK-constrained
 *     `merchant_workspace_id`, and this exchange is pre-tenant/cross-project by nature — there is no
 *     workspace to scope it by. A dedicated pre-tenant nonce ledger is a separate, not-yet-selected
 *     unit, not improvised here by forcing a semantically wrong workspace scope onto it.
 *  3. **`CommerceSessionLinkStore.applyTransition`'s own idempotency map.** Still the pre-ledger,
 *     caller-injected `ReadonlyMap` pattern (same reason as (2) above — no merchant-workspace scope
 *     exists at this layer to key a shared ledger entry by).
 */

export interface CommerceSessionLinkExchangeRouteVariables {
  commerceSessionLinkStore: CommerceSessionLinkStore;
  consumedFederatedExchangeNonces: ReadonlySet<string>;
  appliedSessionLinkIdempotencyKeys: ReadonlyMap<SessionLinkIdempotencyKey, SessionLinkAuthoritativeRecord>;
}

export interface CommerceSessionLinkExchangeHttpSuccessBody {
  readonly principalId: string;
  readonly externalLinkRef: string;
  readonly generation: number;
  readonly revoked: boolean;
  readonly replay: boolean;
}

export interface CommerceSessionLinkExchangeHttpTypedErrorBody {
  readonly code: 'EXCHANGE_NOT_ADMITTED' | 'NO_ACTIVE_SESSION_LINK' | 'SESSION_LINK_CONFLICT' | 'SESSION_LINK_INVALID_TRANSITION';
  readonly reason: string;
  readonly requestId: string;
}

export interface CommerceSessionLinkExchangeHttpInternalErrorBody {
  readonly code: 'INTERNAL_UNEXPECTED';
  readonly retryable: boolean;
  readonly requestId: string;
}

export type CommerceSessionLinkExchangeHttpResult =
  | { readonly httpStatus: 200; readonly body: CommerceSessionLinkExchangeHttpSuccessBody }
  | { readonly httpStatus: 401; readonly body: CommerceSessionLinkExchangeHttpTypedErrorBody }
  | { readonly httpStatus: 409; readonly body: CommerceSessionLinkExchangeHttpTypedErrorBody }
  | { readonly httpStatus: 500; readonly body: CommerceSessionLinkExchangeHttpInternalErrorBody };

export interface CommerceSessionLinkExchangeHttpRequest {
  readonly audience: string;
  readonly purpose: string;
  readonly version: string;
  readonly nonce: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly authProvider: string;
  readonly externalSubjectRef: string;
  readonly operation: SessionLinkOperationKind;
  readonly expectedGeneration: number;
  readonly idempotencyKey: string;
  readonly now: string;
  readonly consumedNonces: ReadonlySet<string>;
  readonly appliedIdempotencyKeys: ReadonlyMap<SessionLinkIdempotencyKey, SessionLinkAuthoritativeRecord>;
  readonly store: CommerceSessionLinkStore;
}

/** Server-owned exchange policy this deployment currently requires; never derived from the request body. */
const SESSION_LINK_EXCHANGE_POLICY: FederatedExchangePolicy = {
  expectedAudience: federatedExchangeAudience('ai-commerce'),
  expectedPurpose: federatedExchangePurpose('session-link-exchange'),
  expectedVersion: '1',
};

function admissionDeniedBody(
  reason: string,
  requestId: string,
): CommerceSessionLinkExchangeHttpTypedErrorBody {
  return { code: 'EXCHANGE_NOT_ADMITTED', reason, requestId };
}

export async function handleCommerceSessionLinkExchangeRequest(
  request: CommerceSessionLinkExchangeHttpRequest,
): Promise<CommerceSessionLinkExchangeHttpResult> {
  const requestId = String(internalId(crypto.randomUUID(), 'Request'));

  const envelope: FederatedExchangeEnvelope = {
    audience: federatedExchangeAudience(request.audience),
    purpose: federatedExchangePurpose(request.purpose),
    version: request.version,
    nonce: federatedExchangeNonce(request.nonce),
    issuedAt: utcTimestamp(request.issuedAt),
    expiresAt: utcTimestamp(request.expiresAt),
  };
  const consumedNonces = new Set([...request.consumedNonces].map((value) => federatedExchangeNonce(value)));

  const admission = evaluateFederatedExchangeAdmission(
    envelope,
    SESSION_LINK_EXCHANGE_POLICY,
    consumedNonces,
    utcTimestamp(request.now),
  );
  if (admission.status === 'DENIED') {
    return { httpStatus: 401, body: admissionDeniedBody(admission.reason, requestId) };
  }

  const verifiedAuthProvider = authProviderKey(request.authProvider);
  const verifiedExternalSubjectRef = externalAuthSubjectRef(request.externalSubjectRef);

  const candidateRead = await request.store.findFederatedCandidates(verifiedAuthProvider, verifiedExternalSubjectRef);
  if (candidateRead.status === 'STORE_ERROR') {
    return { httpStatus: 500, body: { code: 'INTERNAL_UNEXPECTED', retryable: true, requestId } };
  }

  const resolution = resolveCommerceSessionLinkCandidate(
    verifiedAuthProvider,
    verifiedExternalSubjectRef,
    candidateRead.candidates,
  );
  if (resolution.status === 'DENIED') {
    if (resolution.reason === 'LINK_CONFLICT') {
      return { httpStatus: 409, body: { code: 'SESSION_LINK_CONFLICT', reason: resolution.reason, requestId } };
    }
    return { httpStatus: 401, body: { code: 'NO_ACTIVE_SESSION_LINK', reason: resolution.reason, requestId } };
  }

  const idempotencyKey: SessionLinkIdempotencyKey = sessionLinkIdempotencyKey(request.idempotencyKey);
  const outcome = await request.store.applyTransition(
    {
      principalId: resolution.principalId,
      linkRef: resolution.externalLinkRef,
      operation: request.operation,
      expectedGeneration: request.expectedGeneration,
      idempotencyKey,
    },
    request.appliedIdempotencyKeys,
  );

  switch (outcome.status) {
    case 'APPLIED':
    case 'ALREADY_APPLIED':
      return {
        httpStatus: 200,
        body: {
          principalId: String(outcome.resultingRecord.ownerPrincipalId),
          externalLinkRef: String(outcome.resultingRecord.ownerLinkRef),
          generation: outcome.resultingRecord.state.generation,
          revoked: outcome.resultingRecord.state.revoked,
          replay: outcome.status === 'ALREADY_APPLIED',
        },
      };
    case 'CONFLICT':
      return { httpStatus: 409, body: { code: 'SESSION_LINK_CONFLICT', reason: outcome.reason, requestId } };
    case 'RACE_LOST':
      return { httpStatus: 409, body: { code: 'SESSION_LINK_CONFLICT', reason: 'RACE_LOST', requestId } };
    case 'DENIED':
      if (outcome.reason === 'SCOPE_MISMATCH') {
        // Structurally unreachable by construction: principalId/linkRef here are exactly what
        // findFederatedCandidates just read, immediately reused — a mismatch would mean this route
        // itself has a wiring defect, not a client-facing error. Fail closed as a real internal
        // error rather than any client-shaped denial.
        return { httpStatus: 500, body: { code: 'INTERNAL_UNEXPECTED', retryable: false, requestId } };
      }
      return { httpStatus: 409, body: { code: 'SESSION_LINK_INVALID_TRANSITION', reason: outcome.reason, requestId } };
    case 'STORE_ERROR':
      return { httpStatus: 500, body: { code: 'INTERNAL_UNEXPECTED', retryable: true, requestId } };
  }
}

type CommerceSessionLinkExchangeRouteContext = Context<{ Variables: CommerceSessionLinkExchangeRouteVariables }>;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/**
 * Deliberately excludes 'LINK' even though it is a valid `SessionLinkOperationKind` elsewhere: this
 * route resolves a candidate via `findFederatedCandidates`, which only ever returns rows that already
 * exist, so `applyTransition`'s `operation` field never distinguishes 'LINK' from 'RELINK' for a
 * resolved row (`resolveSessionLinkTransition` only special-cases 'UNLINK'; candidate resolution does
 * not read `operation` at all). The one case a caller would naturally send 'LINK' for — no row exists
 * yet — is exactly the case this route cannot serve (`findFederatedCandidates` returns no candidates,
 * so resolution always denies NO_MATCHING_LINK). Accepting 'LINK' here would silently mislead such a
 * caller into a confusing 401 instead of a clear, immediate 400 explaining the operation itself is
 * unsupported through this endpoint. True first-ever link provisioning (creating a brand-new row with
 * no prior candidate) is a separate, not-yet-built unit.
 */
const VALID_OPERATIONS: readonly SessionLinkOperationKind[] = ['RELINK', 'UNLINK'];

function isValidOperation(value: unknown): value is SessionLinkOperationKind {
  return typeof value === 'string' && (VALID_OPERATIONS as readonly string[]).includes(value);
}

function readRequiredStringField(body: unknown, field: string): string | undefined {
  const raw = readUnknownBodyField(body, field);
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

async function runCommerceSessionLinkExchangeRoute(c: CommerceSessionLinkExchangeRouteContext): Promise<Response> {
  const store = c.get('commerceSessionLinkStore');
  if (!store) {
    return jsonResponse({ code: 'SESSION_CONTEXT_NOT_RESOLVED' }, 500);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const fieldOrder: readonly string[] = [
    'audience',
    'purpose',
    'version',
    'nonce',
    'issuedAt',
    'expiresAt',
    'authProvider',
    'externalSubjectRef',
    'idempotencyKey',
  ];
  const parsedStringFields: Record<string, string> = {};
  for (const field of fieldOrder) {
    const value = readRequiredStringField(body, field);
    if (value === undefined) {
      return jsonResponse({ error: 'INVALID_REQUEST', field }, 400);
    }
    parsedStringFields[field] = value;
  }

  const rawOperation = readUnknownBodyField(body, 'operation');
  if (!isValidOperation(rawOperation)) {
    return jsonResponse({ error: 'INVALID_REQUEST', field: 'operation' }, 400);
  }

  const rawExpectedGeneration = readUnknownBodyField(body, 'expectedGeneration');
  const expectedGeneration =
    typeof rawExpectedGeneration === 'number' && Number.isInteger(rawExpectedGeneration) && rawExpectedGeneration >= 0
      ? rawExpectedGeneration
      : undefined;
  if (expectedGeneration === undefined) {
    return jsonResponse({ error: 'INVALID_REQUEST', field: 'expectedGeneration' }, 400);
  }

  const result = await handleCommerceSessionLinkExchangeRequest({
    audience: parsedStringFields.audience ?? '',
    purpose: parsedStringFields.purpose ?? '',
    version: parsedStringFields.version ?? '',
    nonce: parsedStringFields.nonce ?? '',
    issuedAt: parsedStringFields.issuedAt ?? '',
    expiresAt: parsedStringFields.expiresAt ?? '',
    authProvider: parsedStringFields.authProvider ?? '',
    externalSubjectRef: parsedStringFields.externalSubjectRef ?? '',
    operation: rawOperation,
    expectedGeneration,
    idempotencyKey: parsedStringFields.idempotencyKey ?? '',
    now: new Date().toISOString(),
    consumedNonces: c.get('consumedFederatedExchangeNonces') ?? new Set(),
    appliedIdempotencyKeys: c.get('appliedSessionLinkIdempotencyKeys') ?? new Map(),
    store,
  });

  return jsonResponse(result.body, result.httpStatus);
}

/**
 * Registers the real `/v1/session-links/exchange` route on any Hono app — the production
 * `worker.ts` app and an isolated test app alike, so both exercise the identical real dispatch/
 * parse/response path.
 */
export function registerCommerceSessionLinkRoutes(
  app: Hono<{ Variables: CommerceSessionLinkExchangeRouteVariables }>,
): Hono<{ Variables: CommerceSessionLinkExchangeRouteVariables }> {
  app.post('/v1/session-links/exchange', (c) => runCommerceSessionLinkExchangeRoute(c));
  return app;
}
