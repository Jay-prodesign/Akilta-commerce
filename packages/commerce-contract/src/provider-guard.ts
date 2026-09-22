import type { ErrorCode } from '../../domain/src/errors';

export interface ProviderResponsePolicy {
  readonly maxBytes: number;
  readonly allowedContentTypes: readonly string[];
  readonly allowedTopLevelKeys?: readonly string[];
}

export type ProviderResponseGuardResult =
  | { readonly result: 'PASS' }
  | { readonly result: 'FAIL'; readonly code: Extract<ErrorCode, 'PROVIDER_SCHEMA_MISMATCH' | 'PROVIDER_UNSUPPORTED'>; readonly reason: string };

export function validateProviderResponseEnvelope(input: {
  readonly httpStatus: number;
  readonly contentType: string;
  readonly contentLengthBytes: number;
  readonly topLevelKeys?: readonly string[];
  readonly policy: ProviderResponsePolicy;
}): ProviderResponseGuardResult {
  if (input.contentLengthBytes < 0 || input.contentLengthBytes > input.policy.maxBytes) {
    return { result: 'FAIL', code: 'PROVIDER_SCHEMA_MISMATCH', reason: 'RESPONSE_SIZE_OUT_OF_POLICY' };
  }
  const mediaType = input.contentType.split(';', 1)[0]?.trim().toLowerCase();
  if (!mediaType || !input.policy.allowedContentTypes.map((x) => x.toLowerCase()).includes(mediaType)) {
    return { result: 'FAIL', code: 'PROVIDER_UNSUPPORTED', reason: 'CONTENT_TYPE_NOT_ALLOWED' };
  }
  if (input.httpStatus < 200 || input.httpStatus >= 300) {
    return { result: 'FAIL', code: 'PROVIDER_SCHEMA_MISMATCH', reason: 'UNEXPECTED_HTTP_STATUS' };
  }
  if (input.policy.allowedTopLevelKeys && input.topLevelKeys) {
    const allowed = new Set(input.policy.allowedTopLevelKeys);
    if (input.topLevelKeys.some((key) => !allowed.has(key))) {
      return { result: 'FAIL', code: 'PROVIDER_SCHEMA_MISMATCH', reason: 'UNKNOWN_TOP_LEVEL_PROPERTY' };
    }
  }
  return { result: 'PASS' };
}
