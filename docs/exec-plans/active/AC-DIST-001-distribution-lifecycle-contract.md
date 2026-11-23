# AC-DIST-001 — Provider-Neutral Distribution, Acquisition & Lifecycle Contract Maturation

Status: **CONTRACT_MATURATION / SPEC-LEVEL**. Per the Founder's explicit AC-DIST-001
selection, this document prepares and validates the bounded architectural
specification only. It does not invent protected commercial policy, does not
activate any external provider, and does not itself grant merge/deploy/
production/credential/legal/financial authority. Canonical source: BACKLOG
sheet row `AC-DIST-001` (D108 doc 21), DIST-01..13, and the `ACCOUNT_LINK` /
`SHOPIFY_BINDING` / `ENTITLEMENT` / `SURFACE_ACTIVATION` / `OFFBOARDING` rows
of the `STATE_MACHINES` sheet, all re-read fresh for this document rather than
from memory.

## 0. What already exists (independent source verification)

Before specifying anything new, the live tree was checked directly so this
document reuses rather than re-derives:

| Concern | Existing contract | File |
| --- | --- | --- |
| AKILTA-originated / Direct identity + org binding, exact issuer+subject match, no similarity merge, ambiguous-match fail-closed | `resolveAuthenticatedPrincipal`, `resolveAuthOrganizationBinding` | `packages/authz/src/auth-identity.ts` |
| Shopify-originated store binding: BOOTSTRAP / TRANSFER / UNINSTALL / REINSTALL, generation CAS, sticky revocation, scope-exact match | `resolveProviderStoreBindingTransition` | `packages/authz/src/provider-store-binding.ts` (+ `apps/api/src/provider-store-binding-store.ts`) |
| Commerce session link currentness + CAS revoke/relink | `resolveSessionLinkTransition`, `evaluateCommerceSessionLinkCurrentness` | `packages/authz/src/commerce-session-link*.ts` |
| Workspace-context generation fencing | `resolveWorkspaceContextSwitch` | `packages/authz/src/workspace-context-generation.ts` |
| Entitlement: NONE/exact-one/CONFLICT resolution, CAS state machine, dispatch-time generation fencing | `resolveEffectiveEntitlementSource`, `resolveEntitlementTransition`, `evaluateEntitlementGenerationFencing` | `packages/authz/src/entitlement-resolution.ts` (+ `apps/api/src/entitlement-store.ts`) |
| Conversation ownership/handoff CAS state machine (sibling pattern reference, not itself part of acquisition) | `resolveConversationOwnershipTransition` | `packages/authz/src/conversation-ownership-transition.ts` |
| Non-authority derived projection precedent (readiness, not acquisition) | `deriveWorkspaceReadiness` | `packages/domain/src/readiness.ts` |
| Duplicate/out-of-order event convergence | `eventDeduplicationKey`, `classifyDelivery`, `shouldAdvanceMonotonicProjection` | `packages/events/src/operational.ts` |

**Conclusion**: AC-DIST-001 is not a green field. Every one of the eight
points in the Founder's instruction already has a provider-neutral authority
primitive covering most of its mechanics. What is genuinely missing is (a) a
single document that names which contract answers which DIST-xx acceptance
test, so nothing gets rebuilt in parallel, and (b) one small, real gap: there
is no merchant-visible **lifecycle status projection** that composes the
independent install/identity/entitlement axes into the PENDING/PARTIAL/
BLOCKED/CONFLICT/RECONCILIATION_REQUIRED vocabulary DIST-05/12/13 require.
Section 4 proposes that gap-filling unit; nothing else in this contract needs
new production code right now.

## 1. The four acquisition routes, as convergence onto one existing authority axis set

Per the Founder's point 1 and DIST-02 ("Direct/Shopify/Agency Managed routes
converge on one Commerce-owned merchant/workspace authority without forced
shared account/database"): a route is **which verified-identity contract
runs first**, never a separate workspace/authority model.

- **AKILTA-originated / Direct**: `resolveAuthenticatedPrincipal` (AKILTA
  auth provider key) establishes the principal; workspace creation/assignment
  is the pre-existing, separately-owned onboarding flow (out of scope here,
  same as `workspace-context-generation.ts`'s own documented boundary).
- **Shopify-originated**: `resolveProviderStoreBindingTransition` with
  operation `BOOTSTRAP` establishes the (shop, workspace) binding directly —
  this is exactly DIST-01 ("Shopify-originated merchant can establish Commerce
  principal/workspace without AKILTA signup"), already true today: `BOOTSTRAP`
  takes no AKILTA identity as a precondition.
- **Agency Managed**: `AgencyClientAssignment` (`packages/domain/src/tenancy.ts`)
  already models a sponsor/payer organization distinct from the merchant
  workspace it is scoped to, with its own `validFrom`/`validTo`/`status` and
  `resolveCurrentAgencyAssignment`'s NONE/RESOLVED/CONFLICT resolution. This is
  the existing contract for the Founder's point 6 ("agency sponsor/payer !=
  merchant owner/member/authorization; loss of delegation fences access
  without deleting merchant") — an expired/revoked assignment simply stops
  resolving to `RESOLVED`, and nothing in that type or its resolver ever
  deletes or mutates the merchant workspace itself.
- **Hybrid**: not a fifth authority model — it is a workspace that has *more
  than one* of the above bindings resolved concurrently (e.g. a Shopify
  `ProviderStoreBindingRecord` and an AKILTA `AuthenticatedPrincipal`'s
  membership, both pointing at the same `MerchantWorkspaceId`). No new type is
  needed for "Hybrid" — it is the observable state of two independent,
  already-existing bindings sharing a workspace id, which is exactly what
  point 2 requires ("one Commerce-owned principal/workspace authority without
  forced shared accounts": nothing forces the two bindings into one login,
  they simply reference the same workspace).

## 2. Exact verified binding, no similarity merge (point 3 / DIST-03 / DIST-10)

Already structural, not something this contract adds:
- `resolveAuthenticatedPrincipal` filters identities by exact
  `(authProvider, externalSubjectRef)` equality; `matches.length > 1` is
  `IDENTITY_CONFLICT`, never a first-match pick.
- `resolveProviderStoreBindingTransition` keys everything by exact
  `(authProvider, externalStoreRef)`; a request scoped to one ref can never
  touch another's record (`SCOPE_MISMATCH`).
- `resolveAuthOrganizationBinding` returns `null` on more than one active
  exact match — a conflict, never an ordering decision.

No "fuzzy"/similarity comparison (email, domain, shop display name) exists
anywhere in any of these functions. DIST-03 and DIST-10 are closed by
construction already; this document records that rather than re-implementing
a check that already exists.

## 3. Idempotent provisioning, concurrency, partial failure (point 4 / DIST-04,07,08,09,13)

- **Idempotent duplicate/replay** (DIST-04): every CAS function in the table
  above (`resolveProviderStoreBindingTransition`, `resolveEntitlementTransition`,
  `resolveSessionLinkTransition`, `resolveWorkspaceContextSwitch`) takes an
  `appliedIdempotencyKeys` ledger checked first, before any other gate,
  returning the original outcome verbatim on replay. A concurrent/replayed
  acquisition request cannot duplicate an active generation.
- **Route/payer transition after verified rebind, else REVIEW** (DIST-07):
  `ProviderStoreBindingOperationKind.TRANSFER` already requires the caller to
  supply a verified `targetMerchantWorkspaceId` and is CAS-gated; the
  canonical `SHOPIFY_BINDING` state machine's `TRANSFER_REVIEW` state (row 52,
  "Verified transfer/rebind decision... Fail closed on ambiguity") is the
  merchant-visible name for an ambiguous transfer that this contract does not
  resolve automatically — `resolveProviderStoreBindingTransition` never picks
  a winner on ambiguity, so routing an ambiguous transfer to a `REVIEW`
  surface state is a caller-side mapping of its existing `CONFLICT` outcome,
  not new authority logic.
- **Uninstall/reinstall advances generation, never resurrects** (DIST-08):
  already exact — `UNINSTALL` is sticky (`revoked: true`); every ordinary
  operation after that is `DENIED(ALREADY_REVOKED)`; only the explicitly-named
  `REINSTALL` operation may act on a revoked record, and it still advances the
  generation and still requires a fresh verified target workspace.
- **Forged/stale redirect/state/nonce/token/cross-tenant callback denied
  before durable binding** (DIST-09): the `SHOPIFY_BINDING` state machine's
  `UNBOUND -> OAUTH_PENDING` edge already requires "state/nonce" as a
  `required_check`, and `OAUTH_PENDING -> BOUND_VERIFIED` requires readback
  (`forbidden_transition: "BOUND_VERIFIED without readback"`). The actual
  OAuth/state/nonce verification is provider-specific evidence
  (`provider_gate`), out of scope for this provider-neutral contract — but the
  state machine already forbids skipping straight to a bound/verified state
  without it, so no new decision function is needed to express the
  requirement; only the real Shopify OAuth adapter (gated separately) needs it
  enforced at runtime.
- **Partial failure/timeout/duplicate/out-of-order convergence** (DIST-13):
  `eventDeduplicationKey`/`classifyDelivery`/`shouldAdvanceMonotonicProjection`
  (`packages/events/src/operational.ts`) already provide this, reused rather
  than reimplemented, same composition pattern as `inbound-conversation-binding.ts`'s
  CONV-05/CONV-06 and `entitlement-resolution.ts`'s BILLENT-07/08.

## 4. The one genuine gap: merchant-visible lifecycle status (point 7 / DIST-05,12,13)

No existing type answers "what should the merchant see right now" for an
in-progress acquisition. `deriveWorkspaceReadiness` is the nearest precedent
but is a different, already-WhatsApp-specific concern (SC-03's own flagged
gap, not touched here). What DIST-05 and DIST-12 actually require — "incomplete
OAuth/entitlement/configuration/consent remains PARTIAL/BLOCKED, never ACTIVE"
and "public entry/CTA... never infer supported/live channel from route" — is a
**pure, non-authority projection** over the independent axis outcomes the
contracts in Sections 1–3 already produce. This is the one unit proposed for
implementation under this contract (Section 5): `packages/domain/src/acquisition-lifecycle.ts`,
a sibling to `readiness.ts`, composing already-existing axis statuses into one
merchant-visible `AcquisitionLifecycleState` (`PENDING | PARTIAL | ACTIVE |
BLOCKED | CONFLICT | RECONCILIATION_REQUIRED`). It grants nothing — exactly
like `deriveWorkspaceReadiness`, it only reads already-resolved axis states
and never substitutes for the CAS functions that actually decide them.

## 5. Separation of axes (point 5 / DIST-12)

Already structurally distinct across the existing contracts, not merged by
this document:
- **Installation** — `ProviderStoreBindingRecord` / `AuthOrganizationBinding`.
- **Payer** — `AgencyClientAssignment` / `EntitlementRecord.billingSourceRef`
  (observational provenance only, per `entitlement-resolution.ts`'s own doc).
- **Entitlement** — `EntitlementRecord.state`/`generation`.
- **Configuration** — not yet built anywhere (no existing "module
  configuration" authority exists in-repo); left as an opaque caller-supplied
  axis status in Section 4's projection, not invented here.
- **Activation/capability** — `SURFACE_ACTIVATION` state machine (canonical,
  not yet implemented as a decision function — out of scope, belongs to a
  future surface-activation unit, not this contract).
- **Authorization** — `evaluator.ts`/`permission-authority.ts`, already
  independent of all of the above.

No single record anywhere conflates two of these; `EntitlementRecord` was
already proven (BILLENT-12) to carry none of the others.

## 6. DIST-01..13 → existing-or-proposed evidence mapping

| ID | Requirement | Closed by |
| --- | --- | --- |
| DIST-01 | Shopify-originated merchant establishes Commerce principal/workspace without AKILTA signup | `resolveProviderStoreBindingTransition` BOOTSTRAP (existing, no AKILTA precondition) |
| DIST-02 | Direct/Shopify/Agency routes converge on one Commerce-owned authority, no forced shared account | Section 1 — shared `MerchantWorkspaceId` referenced by independent bindings, never a merged login |
| DIST-03 | Exact verified binding only, no similarity auto-merge | `resolveAuthenticatedPrincipal` / `resolveProviderStoreBindingTransition` exact-match filters (existing) |
| DIST-04 | Concurrent/replayed acquisition requests idempotent, no duplicate generations | Idempotency ledger on every CAS function (existing) |
| DIST-05 | Incomplete OAuth/entitlement/configuration/consent stays PARTIAL/BLOCKED, never ACTIVE | **Proposed**: `deriveAcquisitionLifecycleProjection` (Section 4) |
| DIST-06 | Agency sponsor/payer != merchant owner/authorization; lost delegation fences without deleting merchant | `AgencyClientAssignment` + `resolveCurrentAgencyAssignment` (existing) |
| DIST-07 | Route/payer transition preserves workspace only after verified rebind; conflicts to REVIEW | `TRANSFER` operation + `CONFLICT`/ambiguity mapped to the canonical `TRANSFER_REVIEW` surface state (existing decision, caller-side surface mapping) |
| DIST-08 | Uninstall/reinstall advances generation, never resurrects credentials/queued effects | Sticky `revoked` + explicit `REINSTALL`-only exception (existing) |
| DIST-09 | Forged/stale redirect/state/nonce/token/cross-tenant callback denied before durable binding | `SHOPIFY_BINDING` state machine's required-checks (existing contract; real enforcement is provider-evidence-gated, out of scope here) |
| DIST-10 | Simultaneous conflicting claims fail closed, no first/latest-wins | `SCOPE_MISMATCH`/`IDENTITY_CONFLICT`/CAS `CONFLICT` (existing, no timestamp tie-break anywhere) |
| DIST-11 | Cancel/payment failure changes entitlement separately from install/data/identity | `EntitlementRecord` independent of `ProviderStoreBindingRecord`/`AuthOrganizationBinding` (existing, Section 5) |
| DIST-12 | Public entry/CTA/self-service status reflects exact evidence, never infers live channel from route | **Proposed**: same projection as DIST-05 (Section 4) |
| DIST-13 | Partial failure/timeout/duplicate/out-of-order/replay converge via idempotent reconciliation, no false success | `classifyDelivery`/`shouldAdvanceMonotonicProjection` (existing) + the projection's `RECONCILIATION_REQUIRED` state (Section 4) for the merchant-visible surface of that convergence |

Every row is either already closed by an existing, unmodified contract, or
points to the single proposed unit in Section 4. No row requires inventing a
new authority primitive.

## 7. Claim ceiling / non-goals (unchanged from the Founder's framing and the canonical row's own notes)

This document specifies and, for Section 4 only, implements a provider-neutral
decision/projection layer. It does **not**: perform a live Shopify install,
marketplace approval, unified account/SSO, payment, seller-of-record, refund,
price, trial, or tax calculation; make any public-availability promise; touch
`AC-SHOP-LC-106`'s real OAuth adapter, `AC-LIFECYCLE-107`'s cross-axis
orchestrator, `AC-CCIA-001`'s Control Center UI, or `AC-DATASEC-106`'s
retention matrix — all remain separately gated exactly as the canonical row's
dependency list states. No merge/deploy/provider/store/production/credential/
legal/financial authority is exercised or requested by this document or its
Section 4 implementation.

## 8. Genuine blockers / protected decisions isolated (not blocking the rest)

Per the instruction to isolate a genuinely protected question rather than
halting unrelated work: the only point in this contract that is a real,
unavoidable Founder/owner decision — not a routine engineering gap — is
**DIST-07's "verified rebind" criteria**: exactly what counts as sufficient
proof to let a transfer/route/payer change *preserve* an existing workspace
versus forcing a fresh one is a commercial/ownership policy this document does
not invent (the canonical row's own `owner_gate`: "Commercial binding
decisions remain owner/evidence gated"). This is isolated here and does not
block Section 4's implementation, which needs no such criteria — a `CONFLICT`
surfaces as `TRANSFER_REVIEW` regardless of what the eventual approval policy
turns out to be.

No other TRUE STOP condition exists. Section 4's unit is implemented, tested,
and pushed under this same contract; everything else in this document is
specification only, matching the canonical row's `future_artifact_type:
spec+state-machine+tests` and `PLANNED_NOT_SELECTED` status for full
implementation, which this document does not change.
