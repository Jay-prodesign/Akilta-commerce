import {
  evaluateLanguageAuthorityEquivalence,
  type CriticalResponseSnapshot,
} from '../../packages/ai-gateway/src/language-equivalence';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const base: CriticalResponseSnapshot = {
  locale: 'tr-TR',
  factSetRef: 'afs:merchant-a:run-77',
  facts: [
    { key: 'product.price_minor', value: 129900, authorityRef: 'provider:product:123' },
    { key: 'product.currency', value: 'TRY', authorityRef: 'provider:product:123' },
    { key: 'inventory.state', value: 'UNKNOWN', authorityRef: 'inventory-observation:987' },
  ],
  exactIdentifiers: ['gid://product/123', 'ORDER-1042'],
  exactVariantLabels: ['Kadın / 38'],
  unknownRefs: ['inventory.state'],
  conflictRefs: [],
  policyCommitmentRefs: ['policy:return:v5'],
  customerVerificationLevel: 'CV1',
  actionAuthorityState: 'HANDOFF_REQUIRED',
  handoffRequired: true,
  responseText: 'Stok durumunu şu anda doğrulayamıyorum; destek ekibine aktarıyorum.',
};

function english(overrides: Partial<CriticalResponseSnapshot> = {}): CriticalResponseSnapshot {
  return {
    ...base,
    locale: 'en-US',
    responseText: 'I cannot verify current stock right now; I am handing this to support.',
    ...overrides,
  };
}

const tests: Array<readonly [string, () => void]> = [
  ['same authority/facts with different wording passes', () => {
    const result = evaluateLanguageAuthorityEquivalence(base, english());
    assert(result.status === 'PASS', JSON.stringify(result));
  }],
  ['price drift fails', () => {
    const result = evaluateLanguageAuthorityEquivalence(base, english({ facts: [
      { key: 'product.price_minor', value: 139900, authorityRef: 'provider:product:123' },
      { key: 'product.currency', value: 'TRY', authorityRef: 'provider:product:123' },
      { key: 'inventory.state', value: 'UNKNOWN', authorityRef: 'inventory-observation:987' },
    ] }));
    assert(result.mismatches.some((m) => m.code === 'FACT_VALUE_DRIFT'), 'price drift not detected');
  }],
  ['identifier drift fails', () => {
    const result = evaluateLanguageAuthorityEquivalence(base, english({ exactIdentifiers: ['gid://product/123', 'ORDER-9999'] }));
    assert(result.mismatches.some((m) => m.code === 'IDENTIFIER_DRIFT'), 'identifier drift not detected');
  }],
  ['variant label translation drift fails', () => {
    const result = evaluateLanguageAuthorityEquivalence(base, english({ exactVariantLabels: ['Women / 38'] }));
    assert(result.mismatches.some((m) => m.code === 'VARIANT_LABEL_DRIFT'), 'variant label drift not detected');
  }],
  ['unknown dropped fails', () => {
    const result = evaluateLanguageAuthorityEquivalence(base, english({ unknownRefs: [] }));
    assert(result.mismatches.some((m) => m.code === 'UNKNOWN_STATE_DRIFT'), 'unknown drift not detected');
  }],
  ['conflict invented fails', () => {
    const result = evaluateLanguageAuthorityEquivalence(base, english({ conflictRefs: ['policy:conflict:1'] }));
    assert(result.mismatches.some((m) => m.code === 'CONFLICT_STATE_DRIFT'), 'conflict drift not detected');
  }],
  ['policy commitment drift fails', () => {
    const result = evaluateLanguageAuthorityEquivalence(base, english({ policyCommitmentRefs: ['policy:return:v4'] }));
    assert(result.mismatches.some((m) => m.code === 'POLICY_COMMITMENT_DRIFT'), 'policy drift not detected');
  }],
  ['customer verification escalation fails', () => {
    const result = evaluateLanguageAuthorityEquivalence(base, english({ customerVerificationLevel: 'CV2' }));
    assert(result.mismatches.some((m) => m.code === 'CUSTOMER_VERIFICATION_DRIFT'), 'CV drift not detected');
  }],
  ['action authority escalation fails', () => {
    const result = evaluateLanguageAuthorityEquivalence(base, english({ actionAuthorityState: 'ALLOW_READ_ONLY' }));
    assert(result.mismatches.some((m) => m.code === 'ACTION_AUTHORITY_DRIFT'), 'action drift not detected');
  }],
  ['handoff suppression fails', () => {
    const result = evaluateLanguageAuthorityEquivalence(base, english({ handoffRequired: false }));
    assert(result.mismatches.some((m) => m.code === 'HANDOFF_DRIFT'), 'handoff drift not detected');
  }],
  ['fact authority source drift fails', () => {
    const result = evaluateLanguageAuthorityEquivalence(base, english({ facts: [
      { key: 'product.price_minor', value: 129900, authorityRef: 'model:memory' },
      { key: 'product.currency', value: 'TRY', authorityRef: 'provider:product:123' },
      { key: 'inventory.state', value: 'UNKNOWN', authorityRef: 'inventory-observation:987' },
    ] }));
    assert(result.mismatches.some((m) => m.code === 'FACT_AUTHORITY_DRIFT'), 'authority drift not detected');
  }],
  ['fact set drift fails', () => {
    const result = evaluateLanguageAuthorityEquivalence(base, english({ factSetRef: 'afs:merchant-a:run-88' }));
    assert(result.mismatches.some((m) => m.code === 'FACT_SET_REF_DRIFT'), 'fact-set drift not detected');
  }],
];

for (const [name, test] of tests) {
  test();
  console.log(`PASS ${name}`);
}
console.log(`LANGUAGE_EQUIVALENCE_PASS ${tests.length}/${tests.length}`);
