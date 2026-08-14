import { DomainPrimitiveError, type Brand } from './brand';

export type IsoCurrencyCode = Brand<string, 'IsoCurrencyCode'>;

export interface Money {
  readonly amountMinor: bigint;
  readonly currency: IsoCurrencyCode;
}

const ISO_CURRENCY_PATTERN = /^[A-Z]{3}$/;

export function isoCurrencyCode(value: string): IsoCurrencyCode {
  const normalized = value.trim().toUpperCase();
  if (!ISO_CURRENCY_PATTERN.test(normalized)) {
    throw new DomainPrimitiveError('Currency must be a three-letter uppercase ISO-style currency code');
  }
  return normalized as IsoCurrencyCode;
}

export function money(amountMinor: bigint, currency: string | IsoCurrencyCode): Money {
  return Object.freeze({
    amountMinor,
    currency: typeof currency === 'string' ? isoCurrencyCode(currency) : currency,
  });
}

export function sameCurrency(a: Money, b: Money): boolean {
  return a.currency === b.currency;
}

export function addMoney(a: Money, b: Money): Money {
  if (!sameCurrency(a, b)) {
    throw new DomainPrimitiveError('Cannot add Money values with different currencies');
  }
  return money(a.amountMinor + b.amountMinor, a.currency);
}
