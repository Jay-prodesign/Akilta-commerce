import {
  canAdmitProviderExecution,
  providerPublicReferenceCapability,
  referenceCanClaimTargetProviderSupport,
} from '../../packages/commerce-contract/src/provider-reference';

let passed = 0;
function assert(condition: unknown, name: string): void {
  if (!condition) throw new Error(`ASSERT_FAIL:${name}`);
  passed += 1;
}
function throws(fn: () => unknown, name: string): void {
  let didThrow = false;
  try { fn(); } catch { didThrow = true; }
  assert(didThrow, name);
}

const publicRef = providerPublicReferenceCapability({
  provider: 'ideasoft',
  capabilityKey: 'abandoned_cart_read_surface',
  normalizedOperation: 'carts.read',
  evidenceState: 'CONFIRMED_HIGH_LEVEL',
  evidenceMaturity: 'E2_PROVIDER_REFERENCE_PASS',
  evidenceRefs: ['IDEASOFT_OFFICIAL_API_PORTAL_2026-08-08'],
  lastVerifiedAt: '2026-08-08T10:39:00+03:00',
  limitations: ['Exact auth/schema/pagination/consent behavior is not admitted by this reference.'],
});

assert(publicRef.executionAdmitted === false, 'public_reference_execution_false');
assert(publicRef.exactSchemaAdmitted === false, 'public_reference_schema_false');
assert(referenceCanClaimTargetProviderSupport(publicRef) === false, 'public_reference_support_claim_false');
assert(Object.isFrozen(publicRef), 'reference_frozen');
assert(Object.isFrozen(publicRef.evidenceRefs), 'evidence_refs_frozen');
assert(Object.isFrozen(publicRef.limitations), 'limitations_frozen');
throws(() => providerPublicReferenceCapability({
  provider: 'ticimax', capabilityKey: 'product_read', evidenceState: 'CONFIRMED',
  evidenceMaturity: 'E2_PROVIDER_REFERENCE_PASS', evidenceRefs: [], lastVerifiedAt: 'x', limitations: [],
}), 'confirmed_requires_evidence');
throws(() => providerPublicReferenceCapability({
  provider: '', capabilityKey: 'product_read', evidenceState: 'NOT_ASSUMED',
  evidenceMaturity: 'E0_SPECIFIED', evidenceRefs: [], lastVerifiedAt: 'x', limitations: [],
}), 'provider_nonempty');
assert(canAdmitProviderExecution({
  maturity: 'E3_PROVIDER_AUTHENTIC_PASS', provider: 'ideasoft', operationKey: 'get_product',
  authEvidenceRefs: ['auth-readback'], operationEvidenceRefs: ['real-product-payload'],
}) === true, 'e3_with_auth_and_operation_can_admit');
assert(canAdmitProviderExecution({
  maturity: 'E3_PROVIDER_AUTHENTIC_PASS', provider: 'ideasoft', operationKey: 'get_product',
  authEvidenceRefs: [], operationEvidenceRefs: ['real-product-payload'],
}) === false, 'missing_auth_denies');
assert(canAdmitProviderExecution({
  maturity: 'E3_PROVIDER_AUTHENTIC_PASS', provider: 'ideasoft', operationKey: 'get_product',
  authEvidenceRefs: ['auth-readback'], operationEvidenceRefs: [],
}) === false, 'missing_operation_denies');

console.log(`PROVIDER_REFERENCE_PASS ${passed}/11`);
