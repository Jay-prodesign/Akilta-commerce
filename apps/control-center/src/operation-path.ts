import { transportOperation } from '../../api/src/transport-contracts';

/**
 * Builds the real request path for a CONTROL_CENTER_OPERATIONS entry (transport-contracts.ts)
 * by substituting its exact {placeholder} segments. Every path template used here is the
 * one already declared server-side -- nothing is invented. Fails closed (returns null) for
 * an unknown operation key or a missing required path parameter rather than emitting a
 * partially-substituted or guessed path.
 */
export function buildOperationPath(
  operationKey: string,
  pathParams: Readonly<Record<string, string>> = {},
): string | null {
  const operation = transportOperation(operationKey);
  if (!operation) return null;

  const placeholders = operation.path.match(/\{[^}]+\}/g) ?? [];
  let path = operation.path;
  for (const placeholder of placeholders) {
    const name = placeholder.slice(1, -1);
    const value = pathParams[name];
    if (value === undefined || value.length === 0) return null;
    path = path.replace(placeholder, encodeURIComponent(value));
  }
  return path;
}
