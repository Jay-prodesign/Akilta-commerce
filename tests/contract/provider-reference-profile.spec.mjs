import fs from 'node:fs';
const profile = JSON.parse(fs.readFileSync(new URL('./PROVIDER_PUBLIC_REFERENCE_PROFILE_20260808.json', import.meta.url), 'utf8'));
let passed = 0;
const assert = (condition, name) => { if (!condition) throw new Error(`ASSERT_FAIL:${name}`); passed += 1; };
const providers = new Map(profile.providers.map((p) => [p.provider, p]));
assert(profile.global_execution_admitted === false, 'global_execution_false');
assert(providers.size === 3, 'three_providers');
for (const provider of providers.values()) {
  assert(provider.capabilities.every((c) => c.execution_admitted === false), `${provider.provider}_execution_false`);
  assert(provider.capabilities.every((c) => c.exact_schema_admitted === false), `${provider.provider}_schema_false`);
  assert(provider.capabilities.filter((c) => c.evidence_state !== 'NOT_ASSUMED').every((c) => c.evidence_refs.length > 0), `${provider.provider}_confirmed_has_refs`);
}
const meta = providers.get('meta_whatsapp');
const ticimax = providers.get('ticimax');
const ideasoft = providers.get('ideasoft');
assert(meta.capabilities.some((c) => c.capability_key === 'message_status_source_timestamp_ordering' && c.evidence_state === 'CONFIRMED'), 'meta_status_ordering_confirmed');
assert(meta.capabilities.some((c) => c.capability_key === 'exact_webhook_authenticity_signature' && c.evidence_state === 'NOT_ASSUMED'), 'meta_signature_not_assumed');
assert(ticimax.capabilities.some((c) => c.capability_key === 'variant_read' && c.evidence_state === 'CONFIRMED'), 'ticimax_variant_confirmed');
assert(ticimax.capabilities.some((c) => c.capability_key === 'store_stock_read' && c.evidence_state === 'CONFIRMED'), 'ticimax_stock_confirmed');
const abandoned = ideasoft.capabilities.find((c) => c.capability_key === 'abandoned_cart_read_surface');
assert(abandoned?.evidence_state === 'CONFIRMED_HIGH_LEVEL', 'ideasoft_abandoned_cart_high_level');
assert(abandoned?.scope_note?.includes('Post-V1') === true, 'ideasoft_abandoned_cart_post_v1');
assert(ideasoft.capabilities.some((c) => c.capability_key === 'merchant_api_credentials_and_permissions' && c.evidence_state === 'CONFIRMED'), 'ideasoft_permissions_confirmed');
console.log(`PROVIDER_REFERENCE_PROFILE_PASS ${passed}/18`);
