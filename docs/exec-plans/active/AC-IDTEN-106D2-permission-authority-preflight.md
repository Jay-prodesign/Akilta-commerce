# AC-IDTEN-106D2 — Permission-Currentness Implementation-Contract Preflight

Status: **CONTRACT_PREFLIGHT / DOCUMENTATION-ONLY**. No product source, migration,
dependency, or runtime change is made by this document or its PR. This is a
mapping/proposal artifact only, per the bounded AC-IDTEN-106D2 selector in
canonical Drive artifact 25 ("CURRENT BRAIN CHECKPOINT — AC-IDTEN-106D1
SOURCE-OWNER MAPPING / 106D2 SELECTOR — 2026-09-29"), stacked conceptually from
exact verified AC-IDTEN-106C head `a34b90e0c753c28e8a8f3ddfd8aef12fa032c7b6`
(PR #32, PASS/VERIFIED).

## 1. Independent source verification (this session, exact head a34b90e)

Brain's D0/D1 preflight conclusion (`SOURCE_BOUNDARY_GAP`) was independently
re-verified against the live tree before writing this document, not merely
trusted:

- `migrations/0001_foundation.sql:78-82` defines
  `membership_roles(membership_id, role_key)` — a plain two-column
  membership→role-key membership table, no status/validity-window columns.
  Confirmed present.
- `grep -rn "membership_roles" --include="*.ts" .` — **zero matches.** No
  runtime code anywhere in the repository reads this table.
- `Membership.roleRefs` (`packages/domain/src/tenancy.ts`) is a domain field
  on the `Membership` type but is never populated from `membership_roles` or
  consumed by any authorization path; `evaluateAuthorization` does not read it.
- `packages/authz/src/permissions.ts` defines `Permission` as a static
  string-literal union (`PERMISSIONS` const array). No role→`Permission`
  mapping exists anywhere in source — no table, no function, no data file.
- `grep -rln "from 'pg'\|class.*Store\|class.*Repository\|interface.*Store"
  --include="*.ts" packages apps` — **zero matches.** No persistence,
  repository, or database-access layer exists anywhere in this codebase yet,
  despite `pg` being a declared dependency (staged for later use).
- `permissionSnapshot` appears in `apps/api/src/transport-contracts.ts` only
  as an entry in `FORBIDDEN_CLIENT_AUTHORITY_KEYS` — a transport-layer
  defense preventing a client payload from smuggling in that field. It is not
  a generator or reader.

Conclusion matches Brain's: there is no authoritative runtime `membership_roles`
reader and no versioned role→`Permission` policy owner in the admitted tree.
`ExecutionContext.permissionSnapshotRef`/`permissionGrants` are copied,
caller-supplied fields and cannot be treated as current authority, exactly as
AC-IDTEN-106C's evaluator already stopped trusting `membershipStatus`/
`validFrom`/`validTo` for the same reason.

## 2. Minimum substrate mapping

Preferred shape per the D0 preflight refinement ("106D PREFERRED BOUNDED
SOURCE SHAPE"): a server-owned `PermissionAuthoritySnapshot` recomputed at
decision time from (a) the already-resolved current `Membership` (AC-IDTEN-106B's
`resolveCurrentMembership`), (b) the membership's current role keys, and (c) a
versioned server-owned role→`Permission` policy catalog — no snapshot table,
no generation daemon, no migration.

**Key finding of this preflight**: AC-IDTEN-106C already established the
precedent this substrate needs. `membershipCandidates`/`agencyAssignmentCandidates`
on `AuthorizationRequest` are not resolved *inside* `evaluateAuthorization` by
an injected reader — they are plain, caller-supplied arrays that the seam
resolves deterministically. The same pattern generalizes cleanly to role keys:
**no new persistence/repository interface is mechanically necessary**. The
minimum substrate is:

1. **Authoritative role-key input** — a new required plain field alongside
   the existing evidence arrays, e.g. `membershipRoleKeys: readonly string[]`,
   supplied by the caller exactly as `membershipCandidates` is today. Who
   populates it with a real `membership_roles` query is a caller-boundary
   concern outside every currently-admitted production seam, exactly as "who
   populates `membershipCandidates` from a real Membership table" was outside
   106A/106B/106C's scope. No `MembershipRoleReader` port, no async interface,
   no new dependency.
2. **Versioned role→`Permission` policy catalog** — a new static, in-source,
   versioned table (same shape as the existing `PERMISSIONS` const), e.g.
   `ROLE_PERMISSION_POLICY: { policyVersion: string; grants: Readonly<Record<string, readonly Permission[]>> }`.
   Not a runtime service, not a database table — a versioned source constant,
   changed only by a source commit (which is itself the policy-version bump).
3. **Deterministic snapshot resolution** — a pure function
   `resolvePermissionAuthoritySnapshot(membership, roleKeys, target, policy)`
   producing `{ membershipId, merchantWorkspaceId, roleKeys (normalized:
   deduplicated + sorted), policyVersion, effectiveGrants, authorityVersion }`,
   where `authorityVersion` is a deterministic value derived only from
   `membershipId + merchantWorkspaceId + normalized roleKeys + policyVersion`
   (no wall-clock, no randomness) so identical authoritative state always
   yields the identical version and any change to role keys or policy version
   changes it.

No exact runtime reader can be admitted without inventing a new persistence
interface (none exists), but per the finding above, **none needs to be admitted
at this layer** — the minimum interface boundary proposal is the plain
`membershipRoleKeys` array input, not a new port. This satisfies the selector's
"if an exact runtime reader cannot be admitted without a new persistence
interface, return one minimum interface boundary proposal" by proposing the
boundary that avoids needing one.

## 3. Proposed package / source / test boundary (for a future D2-review-gated 106D selection — not built here)

Production source (mirrors the exact four seams 106C already hardened):
- `packages/authz/src/types.ts` — add `PermissionAuthoritySnapshot` type and
  the new required `membershipRoleKeys: readonly string[]` field on
  `AuthorizationRequest` (and on the four production caller inputs).
  `ExecutionContext.permissionSnapshotRef`/`permissionGrants` are left
  unchanged in shape (still present, still not trusted for the grant
  decision — same treatment 106C gave the superseded membership fields).
- `packages/authz/src/permission-authority.ts` (new file) — the versioned
  `ROLE_PERMISSION_POLICY` catalog and the pure
  `resolvePermissionAuthoritySnapshot` function. Owns `PERM-GEN-07/08/09/11`
  determinism.
- `packages/authz/src/evaluator.ts` — after the existing membership/agency
  resolution, resolve the snapshot and use `effectiveGrants` for the final
  permission-grant match instead of `context.permissionGrants`; deny before
  that match on snapshot-ref mismatch (`PERM-GEN-02/03/04`) or resolution
  failure (`PERM-GEN-06/12`).
- `packages/authz/src/action-registry.ts`, `apps/api/src/action-engine.ts`,
  `apps/api/src/grounded-response.ts`, `packages/authz/src/integration-context-change.ts`
  — propagate `membershipRoleKeys` exactly as `membershipCandidates` is
  propagated today. No fifth production file; no new IAM service.

Direct tests (same six files 106C already touches, plus the new source file's
own test):
- `tests/security/auth-identity.spec.ts` — new `PERM-GEN-01..12` cases at the
  `evaluateAuthorization` level, same placement convention as `IDTEN-BIND-01..07`.
- `tests/security/tenant-authz.spec.ts`, `tests/security/action-registry.spec.ts`,
  `tests/security/action-engine.spec.ts`, `tests/contract/grounded-response.spec.ts`,
  `tests/security/integration-context-change.spec.ts` — migrate call sites to
  supply `membershipRoleKeys`, mirroring the F1-correction migration already
  done for `agencyAssignmentCandidates`.
- `tests/security/permission-authority.spec.ts` (new) — direct unit coverage
  of `resolvePermissionAuthoritySnapshot`'s determinism and normalization
  (`PERM-GEN-07/09/11`), including an order/duplicate-invariance permutation
  witness in the same style as AC-IDTEN-106B's `permutations<T>` helper.

`packages/domain/src/tenancy.ts` remains unchanged — role-key resolution has
no historical-conflict shape (`membership_roles` has no status/validity
columns; it is a plain current membership-to-role-key set, not a row history
requiring `resolveCurrentAuthority`-style NONE/CONFLICT handling).

## 4. PERM-GEN-01..12 → executable evidence mapping

| ID | Requirement | Test approach |
| --- | --- | --- |
| PERM-GEN-01 | Exact membership+workspace+current authority version uses current server grants | ALLOW case: resolved snapshot's `effectiveGrants` used for a matching permission |
| PERM-GEN-02 | Stale `permissionSnapshotRef` vs. current snapshot denies before action allow | Mismatched ref → deny before grant match |
| PERM-GEN-03 | Snapshot bound to another membership denies | `authorityVersion`/identity computed for a different `membershipId` → deny |
| PERM-GEN-04 | Snapshot bound to another workspace denies | Same, for `merchantWorkspaceId` |
| PERM-GEN-05 | Role/permission authority change fails closed even if old copied grants still contain the permission | Change `roleKeys`/policy after context built; old copied `permissionGrants` must not authorize |
| PERM-GEN-06 | Missing/unknown/unresolvable current permission authority denies, no fallback to copied grants | Empty/invalid `membershipRoleKeys` → deny, not fallback |
| PERM-GEN-07 | Identical authoritative state → identical deterministic `authorityVersion`/ref | Two resolutions, same inputs → equal `authorityVersion` |
| PERM-GEN-08 | Role assignment/removal changes `authorityVersion`, invalidates prior ref | Add/remove a role key → different `authorityVersion` |
| PERM-GEN-09 | `policyVersion` change changes `authorityVersion` even with unchanged role keys | Bump `policyVersion` only → different `authorityVersion` |
| PERM-GEN-10 | Caller-copied grants cannot widen effective current grants | `context.permissionGrants` contains an extra permission not in the resolved snapshot → deny for that permission |
| PERM-GEN-11 | Role ordering/duplicate role rows cannot create different semantic snapshots | Permutation + duplicate-row witness (mirrors 106B's `permutations<T>`) → identical `authorityVersion` and `effectiveGrants` set |
| PERM-GEN-12 | Current snapshot resolution failure is fail-closed, never falls back to claimed ref or copied grants | Resolution failure path → deny, `context.permissionSnapshotRef`/`permissionGrants` never substituted |

## 5. Testability / near-frontier evidence requirements (selector-mandated)

The D2 selector requires near-frontier evidence rejecting: copied-grant
widening (PERM-GEN-10), stale/mismatched refs (PERM-GEN-02/03/04), membership/
workspace mismatch (PERM-GEN-03/04), role removal/replay (PERM-GEN-08),
policy-version staleness (PERM-GEN-09), duplicate/order variance (PERM-GEN-11),
and current-authority resolution failure (PERM-GEN-06/12). Section 4 maps
each to a specific PERM-GEN case; heavy mutation/property/concurrency work is
explicitly routed to canonical test architecture by the selector and is not
proposed here.

## 6. Claim ceiling / non-goals (unchanged from the selector)

This document closes AC-IDTEN-106D2 preflight only: package/interface
ownership mapping and PERM-GEN evidence mapping. It does **not** implement
`resolvePermissionAuthoritySnapshot`, `permission-authority.ts`, or any
production/test source change, and does not select AC-IDTEN-106D for
implementation. AC-IDTEN-106D source implementation remains **NOT_SELECTED**
pending Brain review of this preflight. It does not touch session/link
revocation, credential lifecycle, queued-work reauthorization, billing/
entitlement, or provider/production behavior. No merge/deploy/provider/store/
production/credential/legal/financial/maturity authority is exercised or
requested by this document.

## 7. Genuine blockers

None. No TRUE STOP condition was encountered — this preflight did not require
any product-source, migration, dependency, or runtime mutation, and no
canonical authority conflict was found (independent source verification in
Section 1 confirms, rather than contradicts, Brain's D0/D1 conclusion).
