import { DomainPrimitiveError, type Brand } from './brand';

export type LocaleTag = Brand<string, 'LocaleTag'>;

function getCanonicalLocale(value: string): string {
  try {
    const [canonical] = Intl.getCanonicalLocales(value);
    if (!canonical) {
      throw new Error('No canonical locale returned');
    }
    return canonical;
  } catch {
    throw new DomainPrimitiveError('Locale must be a valid BCP-47 style locale tag');
  }
}

/** Re-validates the canonical string actually being returned via the identical Intl check. */
function assertIsLocaleTag(value: string): asserts value is LocaleTag {
  if (getCanonicalLocale(value) !== value) {
    throw new DomainPrimitiveError('Locale must be a valid BCP-47 style locale tag');
  }
}

export function localeTag(value: string): LocaleTag {
  const candidate = value.trim();
  if (candidate.length === 0) {
    throw new DomainPrimitiveError('Locale must be non-empty');
  }

  const canonical = getCanonicalLocale(candidate);
  assertIsLocaleTag(canonical);
  return canonical;
}
