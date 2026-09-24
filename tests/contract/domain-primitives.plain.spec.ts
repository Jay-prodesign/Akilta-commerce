import {
  ERROR_CODES,
  SUPPORT_STATES,
  addMoney,
  idempotencyKey,
  internalId,
  localeTag,
  money,
  utcTimestamp,
} from '../../packages/domain/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function expectThrow(fn: () => unknown, message: string): void {
  let threw = false;
  try { fn(); } catch { threw = true; }
  assert(threw, message);
}

assert(internalId('org_opaque_001', 'Organization') === 'org_opaque_001', 'opaque ID changed');
expectThrow(() => internalId('   ', 'Organization'), 'blank ID accepted');
const sum = addMoney(money(100n, 'usd'), money(250n, 'USD'));
assert(sum.amountMinor === 350n && sum.currency === 'USD', 'money arithmetic failed');
expectThrow(() => addMoney(money(100n, 'USD'), money(100n, 'EUR')), 'cross-currency arithmetic accepted');
assert(utcTimestamp('2026-08-07T12:00:00+03:00') === '2026-08-07T09:00:00.000Z', 'UTC normalization failed');
assert(localeTag('tr-tr') === 'tr-TR', 'locale canonicalization failed');
assert(SUPPORT_STATES.includes('UNKNOWN') && SUPPORT_STATES.includes('BLOCKED_BY_ACCESS'), 'support states missing');
assert(ERROR_CODES.includes('AUTH_TENANT_MISMATCH') && ERROR_CODES.includes('AI_OUTPUT_GROUNDEDNESS_FAIL'), 'error taxonomy missing');
assert(idempotencyKey('merchant:operation:key') === 'merchant:operation:key', 'idempotency key changed');
expectThrow(() => idempotencyKey(''), 'blank idempotency key accepted');
console.log('domain-primitives.plain.spec: PASS 6/6');
