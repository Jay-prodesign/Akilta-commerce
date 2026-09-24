import {
  internalId,
  externalId,
  idempotencyKey,
  localeTag,
  isoCurrencyCode,
  utcTimestamp,
  providerTimestamp,
  operationalStatus,
  workspaceOnboardingState,
  moduleKey,
  timezoneId,
  channelType,
  conversationStatus,
  providerMessageStatus,
} from '../../packages/domain/src';
import { productStatus, providerSellabilityState } from '../../packages/commerce-contract/src/product';
import { providerStatus } from '../../packages/commerce-contract/src/order';
import { trainingEligibility, NOT_CLASSIFIED } from '../../packages/events/src/lineage';
import { usageUnit, rateCardVersion, reconciliationState } from '../../packages/events/src/usage';
import {
  authProviderKey,
  externalAuthSubjectRef,
  externalAuthOrganizationRef,
  externalSessionRef,
} from '../../packages/authz/src/auth-identity';
import { opaqueCursor } from '../../apps/api/src/transport-contracts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function expectThrow(run: () => void, message: string): void {
  let threw = false;
  try { run(); } catch { threw = true; }
  assert(threw, message);
}

const cases: Array<[string, () => void]> = [
  // Every simple non-empty-string brand: invalid rejected, valid preserves the exact primitive.
  ['internalId rejects empty, preserves primitive', () => {
    expectThrow(() => internalId('   ', 'MerchantWorkspace'), 'internalId accepted blank value');
    assert(internalId('mw-1', 'MerchantWorkspace') === 'mw-1', 'internalId must equal its own primitive value');
  }],
  ['externalId rejects empty, preserves primitive', () => {
    expectThrow(() => externalId('', 'Product'), 'externalId accepted empty value');
    assert(externalId('ext-1', 'Product') === 'ext-1', 'externalId must equal its own primitive value');
  }],
  ['idempotencyKey rejects empty, preserves primitive', () => {
    expectThrow(() => idempotencyKey(''), 'idempotencyKey accepted empty value');
    assert(idempotencyKey('k-1') === 'k-1', 'idempotencyKey must equal its own primitive value');
  }],
  ['providerTimestamp rejects empty, preserves primitive', () => {
    expectThrow(() => providerTimestamp('  '), 'providerTimestamp accepted blank value');
    assert(providerTimestamp('provider-ts-1') === 'provider-ts-1', 'providerTimestamp must equal its own primitive value');
  }],
  ['operationalStatus/workspaceOnboardingState/moduleKey reject empty, preserve primitive', () => {
    expectThrow(() => operationalStatus(''), 'operationalStatus accepted empty value');
    expectThrow(() => workspaceOnboardingState(''), 'workspaceOnboardingState accepted empty value');
    expectThrow(() => moduleKey(''), 'moduleKey accepted empty value');
    assert(operationalStatus('ACTIVE') === 'ACTIVE', 'operationalStatus must equal its own primitive value');
    assert(workspaceOnboardingState('DONE') === 'DONE', 'workspaceOnboardingState must equal its own primitive value');
    assert(moduleKey('whatsapp') === 'whatsapp', 'moduleKey must equal its own primitive value');
  }],
  ['channelType/conversationStatus/providerMessageStatus reject empty, preserve primitive', () => {
    expectThrow(() => channelType(''), 'channelType accepted empty value');
    expectThrow(() => conversationStatus(''), 'conversationStatus accepted empty value');
    expectThrow(() => providerMessageStatus(''), 'providerMessageStatus accepted empty value');
    assert(channelType('WHATSAPP') === 'WHATSAPP', 'channelType must equal its own primitive value');
    assert(conversationStatus('AI_ACTIVE') === 'AI_ACTIVE', 'conversationStatus must equal its own primitive value');
    assert(providerMessageStatus('DELIVERED') === 'DELIVERED', 'providerMessageStatus must equal its own primitive value');
  }],
  ['productStatus/providerSellabilityState/providerStatus reject empty, preserve primitive', () => {
    expectThrow(() => productStatus(''), 'productStatus accepted empty value');
    expectThrow(() => providerSellabilityState(''), 'providerSellabilityState accepted empty value');
    expectThrow(() => providerStatus(''), 'providerStatus accepted empty value');
    assert(productStatus('ACTIVE') === 'ACTIVE', 'productStatus must equal its own primitive value');
    assert(providerSellabilityState('AVAILABLE') === 'AVAILABLE', 'providerSellabilityState must equal its own primitive value');
    assert(providerStatus('SHIPPED') === 'SHIPPED', 'providerStatus must equal its own primitive value');
  }],
  ['trainingEligibility rejects empty, preserves primitive, NOT_CLASSIFIED constant is real', () => {
    expectThrow(() => trainingEligibility(''), 'trainingEligibility accepted empty value');
    assert(trainingEligibility('ELIGIBLE') === 'ELIGIBLE', 'trainingEligibility must equal its own primitive value');
    assert(NOT_CLASSIFIED === 'NOT_CLASSIFIED', 'NOT_CLASSIFIED must be the literal string it names');
  }],
  ['usageUnit/rateCardVersion/reconciliationState reject empty, preserve primitive', () => {
    expectThrow(() => usageUnit(''), 'usageUnit accepted empty value');
    expectThrow(() => rateCardVersion(''), 'rateCardVersion accepted empty value');
    expectThrow(() => reconciliationState(''), 'reconciliationState accepted empty value');
    assert(usageUnit('AI_MESSAGE') === 'AI_MESSAGE', 'usageUnit must equal its own primitive value');
    assert(rateCardVersion('v1') === 'v1', 'rateCardVersion must equal its own primitive value');
    assert(reconciliationState('RECONCILED') === 'RECONCILED', 'reconciliationState must equal its own primitive value');
  }],
  ['authProviderKey/externalAuthSubjectRef/externalAuthOrganizationRef/externalSessionRef reject empty, preserve primitive', () => {
    expectThrow(() => authProviderKey(''), 'authProviderKey accepted empty value');
    expectThrow(() => externalAuthSubjectRef(''), 'externalAuthSubjectRef accepted empty value');
    expectThrow(() => externalAuthOrganizationRef(''), 'externalAuthOrganizationRef accepted empty value');
    expectThrow(() => externalSessionRef(''), 'externalSessionRef accepted empty value');
    assert(authProviderKey('meta') === 'meta', 'authProviderKey must equal its own primitive value');
    assert(externalAuthSubjectRef('sub-1') === 'sub-1', 'externalAuthSubjectRef must equal its own primitive value');
    assert(externalAuthOrganizationRef('org-1') === 'org-1', 'externalAuthOrganizationRef must equal its own primitive value');
    assert(externalSessionRef('sess-1') === 'sess-1', 'externalSessionRef must equal its own primitive value');
  }],
  ['opaqueCursor rejects empty, preserves primitive', () => {
    expectThrow(() => opaqueCursor('  '), 'opaqueCursor accepted blank value');
    assert(opaqueCursor('cursor-1') === 'cursor-1', 'opaqueCursor must equal its own primitive value');
  }],

  // Format-validated brands: exact same invariant as before, still preserved.
  ['isoCurrencyCode enforces three-letter uppercase, preserves primitive', () => {
    expectThrow(() => isoCurrencyCode('usdollar'), 'isoCurrencyCode accepted a non-ISO value');
    expectThrow(() => isoCurrencyCode('12'), 'isoCurrencyCode accepted digits');
    assert(isoCurrencyCode('usd') === 'USD', 'isoCurrencyCode must normalize case and equal the resulting primitive');
  }],
  ['localeTag enforces BCP-47 validity, preserves canonical primitive', () => {
    expectThrow(() => localeTag('not a locale!!'), 'localeTag accepted an invalid tag');
    assert(localeTag('tr-tr') === 'tr-TR', 'localeTag must canonicalize and equal the resulting primitive');
  }],
  ['timezoneId enforces IANA validity, preserves primitive', () => {
    expectThrow(() => timezoneId('Not/ARealZone'), 'timezoneId accepted an invalid IANA zone');
    assert(timezoneId('Europe/Istanbul') === 'Europe/Istanbul', 'timezoneId must equal its own primitive value');
  }],
  ['utcTimestamp enforces parseability, normalizes and preserves primitive equality', () => {
    expectThrow(() => utcTimestamp('not-a-date'), 'utcTimestamp accepted an unparseable value');
    const a = utcTimestamp('2026-08-09T20:30:00.000Z');
    const b = utcTimestamp('2026-08-09T20:30:00.000Z');
    assert(a === b, 'utcTimestamp constructed twice from the same input must be primitive-equal');
    assert(a === '2026-08-09T20:30:00.000Z', 'utcTimestamp must equal the expected ISO primitive');
  }],

  // Primitive equality/serialization/tenant-scope proofs required by the Brain resolution.
  ['same-value branded IDs are primitive-equal, different-value ones are not (mirrors evaluator.ts scope match)', () => {
    const scopeWorkspace = internalId('mw-shared', 'MerchantWorkspace');
    const targetWorkspaceSame = internalId('mw-shared', 'MerchantWorkspace');
    const targetWorkspaceOther = internalId('mw-other', 'MerchantWorkspace');
    assert(scopeWorkspace === targetWorkspaceSame, 'grant scope must still === match the same tenant, exactly as packages/authz/src/evaluator.ts requires');
    assert(scopeWorkspace !== targetWorkspaceOther, 'grant scope must still !== reject a different tenant, exactly as packages/authz/src/evaluator.ts requires');
  }],
  ['branded values serialize identically to their raw primitive', () => {
    const id = internalId('mw-json-1', 'MerchantWorkspace');
    assert(JSON.stringify({ merchantWorkspaceId: id }) === JSON.stringify({ merchantWorkspaceId: 'mw-json-1' }), 'branded ID must serialize exactly as its raw string');
    const ts = utcTimestamp('2026-08-09T20:30:00.000Z');
    assert(JSON.stringify({ occurredAt: ts }) === '{"occurredAt":"2026-08-09T20:30:00.000Z"}', 'branded timestamp must serialize exactly as its raw string');
  }],
  ['branded values behave as plain strings at runtime (typeof, template literals, Map keys)', () => {
    const id = internalId('mw-runtime-1', 'MerchantWorkspace');
    assert(typeof id === 'string', 'branded ID must remain typeof string, not an object wrapper');
    assert(`prefix:${id}` === 'prefix:mw-runtime-1', 'branded ID must interpolate as its raw string');
    const map = new Map<string, number>([[id, 1]]);
    assert(map.get('mw-runtime-1') === 1, 'branded ID must be usable as a plain string Map key');
  }],
];

let pass = 0;
for (const [name, run] of cases) { run(); pass += 1; console.log(`PASS ${name}`); }
console.log(`PASS ${pass}/${cases.length} branded-primitive narrowing scenarios`);
