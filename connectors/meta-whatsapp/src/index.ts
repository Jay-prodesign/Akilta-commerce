import type { UtcTimestamp } from '../../../packages/domain/src';

export * from './e3-acceptance';

export const META_WHATSAPP_STAGING_OPERATIONS = Object.freeze({
  webhookAuthenticity: 'BLOCKED_BY_ACCESS',
  inboundMessageNormalization: 'BLOCKED_BY_ACCESS',
  outboundMessageSend: 'BLOCKED_BY_ACCESS',
  onboarding: 'BLOCKED_BY_ACCESS',
} as const);

export interface MetaWhatsAppEvidenceGatedResult {
  readonly status: 'BLOCKED_BY_ACCESS';
  readonly evidenceRefs: readonly string[];
  readonly warnings: readonly string[];
  readonly retrievedAt: UtcTimestamp;
}

/** No provider payload schema, signature algorithm, endpoint, token or send DTO is guessed here. */
export function metaWhatsAppEvidenceGatedResult(now: UtcTimestamp): MetaWhatsAppEvidenceGatedResult {
  return {
    status: 'BLOCKED_BY_ACCESS',
    evidenceRefs: [],
    warnings: ['Provider-authentic Meta test-app/webhook/send/onboarding evidence is required before adapter implementation.'],
    retrievedAt: now,
  };
}
