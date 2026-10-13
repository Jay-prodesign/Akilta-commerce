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
