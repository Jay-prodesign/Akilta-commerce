# Migration staging rules

- `0001_foundation.sql` is a PostgreSQL-oriented staging artifact derived from canonical document 27.
- It is not yet applied to a production database and does not freeze the managed PostgreSQL vendor.
- IDs are opaque internal `TEXT`; provider IDs are scoped by `integration_id` and never global primary keys.
- Money uses integer minor units (`BIGINT`) plus currency code; floating point money is prohibited.
- Secret values are prohibited. `credential_reference` is an external secret-manager pointer only.
- High-risk tenant relationships use composite `(entity_id, merchant_workspace_id)` foreign keys where practical.
- Audit/evaluation/observation tables are append-only at application/repository authority; no ordinary update/delete API should be exposed.
- `0001_foundation.preproduction_rollback.sql` is only for local/pre-production recovery before real tenant data. Production evolution is forward/additive-first with explicit compensation/restore procedures.
- Database execution, backup/restore and real migration acceptance remain runtime evidence tasks.

## Authentication identity boundary addition

`0001_foundation.sql` now includes provider-neutral `auth_organization_bindings`. An external auth organization reference maps only to an internal `Organization`; it never maps directly to `MerchantWorkspace` and never grants permissions. Session/provider claims remain authentication evidence only; application Membership, AgencyClientAssignment and permission checks stay authoritative.

## SC-02 provider-store binding addition

`0001_foundation.sql` now includes `provider_store_bindings` (ID-G10): a provider-originated store (e.g. a Shopify shop install) maps to exactly one `MerchantWorkspace`, independently of `auth_organization_bindings` and never merged with it by similarity. `generation` is an optimistic-concurrency (CAS) column — every transition (`apps/api/src/provider-store-binding-store.ts`) must match it exactly via `UPDATE ... WHERE generation = $n`, a single atomically-consistent statement requiring no explicit transaction. `revoked` is sticky until an explicit REINSTALL. This table is authentication/binding evidence only; it never itself grants permission, workspace, or action authority.

## SC-02 commerce session-link addition

`0001_foundation.sql` now includes `commerce_session_links` (XSESS-06): the authoritative generation/revoked record a linked Commerce session's currentness is evaluated against, independent of any externally-presented session token/cache. Same CAS discipline and single-statement-atomic transition technique as `provider_store_bindings`, applied via `apps/api/src/commerce-session-link-store.ts`. This table never itself grants workspace/permission authority.

## SC-02 workspace-context addition

`0001_foundation.sql` now includes `workspace_contexts` (XSESS-05): one principal's currently active workspace, fenced by `generation` so a stale cache/tab cannot act in the old or new workspace merely by copying an id — switching back to the same workspace still advances the generation. Applied via `apps/api/src/workspace-context-store.ts`, UPDATE-only (no insert path): a principal's very first workspace assignment is a separate, not-yet-selected onboarding concern.

## SC-04 entitlement addition

`0001_foundation.sql` now includes `entitlements` (AC-BILLENT-106): the single authoritative, generation-tracked workspace+module grant, keyed `UNIQUE (merchant_workspace_id, module_key)`. A missing row is the structural `NONE` state (no grant exists yet), never a store error — the first grant (`NONE -> TRIAL|ACTIVE`) is a conflict-free `INSERT ... ON CONFLICT DO NOTHING`, every later transition a CAS `UPDATE ... WHERE generation = $n`, same technique as `commerce_session_links`. Applied via `apps/api/src/entitlement-store.ts`. `billing_source_ref` is observational provenance only — never part of this row's identity, so a payer/billing-source switch never changes which workspace the entitlement belongs to. This table never itself grants installation, configuration, capability, or action authorization.

## SC-05 customer identity link addition (AC-XCID-107)

`customer_identities` now has `link_generation` (CAS precondition for the `CustomerIdentity -> CustomerId` pointer, `packages/authz/src/customer-identity-link-transition.ts`), and `0001_foundation.sql` adds the append-only `customer_identity_link_events` audit table (`CHECK (to_generation = from_generation + 1)`, same discipline as `conversation_ownership_events`) — the canonical XCID closure criterion "identity corrections are reversible/auditable" requires a real lineage trail, not just the current pointer. Applied via `apps/api/src/customer-identity-link-store.ts`, UPDATE-only (no insert path): a `customer_identities` row's initial creation remains a separate, not-yet-built adapter concern, same precedent as `conversations`' initial row in the SC-05 ownership addition above. `verification_level`/`verification_expires_at` are untouched by this table's link pointer — verification is a property of the identity itself and is never carried over by a LINK/RELINK, which is what makes "verification non-transfer" (XCID-05) true by construction.
