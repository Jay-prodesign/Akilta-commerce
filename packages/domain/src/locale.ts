import { DomainPrimitiveError, type Brand } from './brand';

export type LocaleTag = Brand<string, 'LocaleTag'>;

export function localeTag(value: string): LocaleTag {
  const candidate = value.trim();
  if (candidate.length === 0) {
    throw new DomainPrimitiveError('Locale must be non-empty');
  }

  try {
    const [canonical] = Intl.getCanonicalLocales(candidate);
    if (!canonical) {
      throw new Error('No canonical locale returned');
    }
    return canonical as LocaleTag;
  } catch {
    throw new DomainPrimitiveError('Locale must be a valid BCP-47 style locale tag');
  }
}
