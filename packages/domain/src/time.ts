import { DomainPrimitiveError, type Brand } from './brand';

export type UtcTimestamp = Brand<string, 'UtcTimestamp'>;
export type ProviderTimestamp = Brand<string, 'ProviderTimestamp'>;

/**
 * Re-validates the actual string being returned (date.toISOString() output), not the original
 * possibly-Date input -- the invariant this proves is exactly "parseable as a valid date/time",
 * identical to the check above, applied to the value that is actually claimed as UtcTimestamp.
 */
function assertIsUtcTimestamp(value: string): asserts value is UtcTimestamp {
  if (Number.isNaN(new Date(value).getTime())) {
    throw new DomainPrimitiveError('Timestamp must be parseable as a valid date/time');
  }
}

function assertIsProviderTimestamp(value: string): asserts value is ProviderTimestamp {
  if (value.trim().length === 0) {
    throw new DomainPrimitiveError('ProviderTimestamp must be non-empty');
  }
}

export function utcTimestamp(value: string | Date): UtcTimestamp {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new DomainPrimitiveError('Timestamp must be parseable as a valid date/time');
  }
  const iso = date.toISOString();
  assertIsUtcTimestamp(iso);
  return iso;
}

export function providerTimestamp(value: string): ProviderTimestamp {
  assertIsProviderTimestamp(value);
  return value;
}
