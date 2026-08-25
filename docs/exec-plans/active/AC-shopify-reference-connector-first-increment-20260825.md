# Shopify Reference-Connector — First Real Increment (D-099) — 2026-08-25

Responds to "AKILTA COMMERCE — CONTINUE WITHOUT BLOCKER WAITING": Meta test-number and
Ticimax access are explicitly not project-wide blockers; execute the largest safe,
dependency-safe, provider-independent V1 work now, prioritizing real Shopify
implementation behind the provider-agnostic commerce-contract abstraction.

## What was implemented this checkpoint

1. **`connectors/shopify/src/index.ts`** (new) — the previously-missing Shopify
   counterpart to the existing Ticimax/IdeaSoft/ikas/T-Soft/Meta evidence-gated stubs.
   Every other CR-V1 connector already had one; Shopify — D-099's designated default
   `REFERENCE_CONNECTOR` — had none. Same fail-closed pattern: all capabilities
   `BLOCKED_BY_ACCESS`/`UNKNOWN`, never `AVAILABLE`, `execute()` fail-closed. Capability
   limitations cite real Shopify Admin GraphQL schema facts confirmed this session via
   read-only schema introspection (no store touched): the Order object's default 60-day
   window + `read_all_orders` scope requirement; `InventoryLevel.quantities(names:[...])`
   exposing multiple named states rather than one raw number.
2. **`connectors/shopify/src/mapping.ts`** (new) — genuine adapter-layer mapping logic,
   not just capability metadata: `mapShopifyInventoryToDerivationInput` /
   `deriveShopifyAvailability` map real, schema-verified fields
   (`InventoryItem.tracked`, `ProductVariant.inventoryPolicy` [`DENY`/`CONTINUE`],
   `ProductVariant.availableForSale`, `ProductVariant.sellableOnlineQuantity`) into the
   existing normalized `InventoryDerivationInput`/`deriveAvailability` contract
   unchanged. `deriveShopifyOrderCompletenessScope` encodes the real 60-day default
   window / `read_all_orders` fact as a `CompletenessScope`, failing closed to
   `UNKNOWN` rather than asserting a boundary the evidence doesn't support.
3. Test coverage: `connector-stubs.spec.ts` extended (Shopify fail-closed assertion),
   `tests/contract/shopify-reference-connector-stub.spec.mjs` (new, 10/10) and
   `tests/contract/shopify-connector-mapping.spec.ts` (new, 11/11) — all synthetic
   fixtures, zero store access. Also wired the previously-unregistered
   `phase1b-evidence-gated-connectors.spec.mjs` into `run-staging-tests.mjs` (it existed
   but was never actually executed by `pnpm test`).

## Checks (fresh, this checkpoint)

Main typecheck PASS 0 errors; staging typecheck PASS 0 errors; lint PASS 0 errors;
staging dependency-free suite **50/50 PASS** (was 47/47 at session start: +1
connector-stubs assertions, +1 phase1b wiring, +1 shopify-reference-connector-stub,
+1 shopify-connector-mapping); vitest 6/6 PASS; `pnpm audit` clean.

## What this is not

No E3 provider-authentic execution, no store credential, no live-store mutation, no
P0-027 `COMPLETED`/`VERIFIED` claim. `SHOPIFY_TARGET_CONTEXT_ACCESS_GATE` (D-100) is
unchanged and still blocks real execution against an isolated target — this increment
is exactly the "adapter+fixtures" portion of P0-027's own acceptance criteria that does
not require it, kept strictly separate from the "conformance report+provider evidence"
portion that does.

## Survey of the non-test-number WhatsApp/V1 lane (no code produced here)

Before committing to this Shopify-only mission, the adjacent provider-independent V1
surfaces were surveyed for an equally concrete gap: webhook ingress boundary
(`decideWebhookIngress`), grounded-response orchestration (truth/policy resolution,
tool-subset validation, model routing/fallback authority invariants, audit/evaluation
event trail), the CR-V1 AI tool registry, and async retry/DLQ/idempotency policy are
already implemented and covered by existing passing tests
(`webhook-ingress-boundary.spec.ts`, `grounded-response.spec.ts`, `ai-routing.spec.ts`,
`ai-tool-registry.spec.ts`, `async-retry-dlq.spec.ts`). The one genuinely open
WhatsApp-specific item — real Meta webhook payload parsing/signature verification — is
correctly left `BLOCKED_BY_ACCESS` in `connectors/meta-whatsapp/src/index.ts`: unlike
Shopify's public, introspectable Admin GraphQL schema, Meta's exact wire payload/
signature scheme is not something this session can verify without provider access, and
the codebase's own pre-existing, consistently-applied rule is to never guess it. This is
the same "no unverified provider schema" discipline already applied to every other
connector, not a newly invented excuse — so it was not re-implemented speculatively.

## Status

`IMPLEMENTED` (ceiling; not `VERIFIED`/`COMPLETED`). Both external blockers stay scoped
exactly as instructed: `BLOCKED_EXTERNAL — META TEST NUMBER` (Meta E3) and
`BLOCKED_EXTERNAL — TICIMAX ACCESS` (Ticimax provider-authentic mapping) — neither is a
project-wide stop. This checkpoint is not a saturation report; it is a bounded-mission
completion. Engineering continues to the next dependency-safe unit without waiting on
either external blocker.
