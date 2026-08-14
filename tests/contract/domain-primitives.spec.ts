import { describe, expect, it } from 'vitest';
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

describe('P0-001 domain primitives', () => {
  it('keeps internal IDs opaque and non-empty without freezing UUID/ULID format', () => {
    expect(internalId('org_opaque_001', 'Organization')).toBe('org_opaque_001');
    expect(() => internalId('   ', 'Organization')).toThrow();
  });

  it('stores money in minor units and rejects cross-currency arithmetic', () => {
    expect(addMoney(money(100n, 'usd'), money(250n, 'USD'))).toEqual({
      amountMinor: 350n,
      currency: 'USD',
    });
    expect(() => addMoney(money(100n, 'USD'), money(100n, 'EUR'))).toThrow();
  });

  it('normalizes timestamps to UTC ISO strings', () => {
    expect(utcTimestamp('2026-08-07T12:00:00+03:00')).toBe('2026-08-07T09:00:00.000Z');
  });

  it('canonicalizes locale tags', () => {
    expect(localeTag('tr-tr')).toBe('tr-TR');
  });

  it('preserves canonical support states and error taxonomy', () => {
    expect(SUPPORT_STATES).toContain('UNKNOWN');
    expect(SUPPORT_STATES).toContain('BLOCKED_BY_ACCESS');
    expect(ERROR_CODES).toContain('AUTH_TENANT_MISMATCH');
    expect(ERROR_CODES).toContain('AI_OUTPUT_GROUNDEDNESS_FAIL');
  });

  it('requires non-empty idempotency keys', () => {
    expect(idempotencyKey('merchant:operation:key')).toBe('merchant:operation:key');
    expect(() => idempotencyKey('')).toThrow();
  });
});
