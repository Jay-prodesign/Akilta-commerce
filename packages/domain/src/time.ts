import { DomainPrimitiveError, type Brand } from './brand';

export type UtcTimestamp = Brand<string, 'UtcTimestamp'>;
export type ProviderTimestamp = Brand<string, 'ProviderTimestamp'>;

export function utcTimestamp(value: string | Date): UtcTimestamp {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new DomainPrimitiveError('Timestamp must be parseable as a valid date/time');
  }
  return date.toISOString() as UtcTimestamp;
}

export function providerTimestamp(value: string): ProviderTimestamp {
  if (value.trim().length === 0) {
    throw new DomainPrimitiveError('ProviderTimestamp must be non-empty');
  }
  return value as ProviderTimestamp;
}
