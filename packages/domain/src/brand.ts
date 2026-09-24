export type Brand<T, Name extends string> = T & { readonly __brand: Name };

export class DomainPrimitiveError extends Error {
  override readonly name = 'DomainPrimitiveError';

  constructor(message: string) {
    super(message);
  }
}

export function assertNonEmptyString(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new DomainPrimitiveError(`${label} must be a non-empty string`);
  }
  return value;
}
