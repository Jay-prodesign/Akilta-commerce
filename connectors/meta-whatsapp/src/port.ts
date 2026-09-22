import type {
  ConversationId,
  IdempotencyKey,
  Message,
  OutboundSendResult,
} from '../../../packages/domain/src';

/**
 * D-103 Lane A (EXECUTABLE_PROVIDER_NEUTRAL): this is our own normalized send contract,
 * not Meta's wire format. No WhatsApp Cloud API endpoint, payload schema, template
 * structure or token is encoded here. A later Lane-B adapter implementation translates
 * this request into the real provider call; this interface is what it must satisfy.
 */
export interface MetaWhatsAppSendRequest {
  readonly conversationId: ConversationId;
  /** Provider-neutral destination reference (e.g. resolved WhatsApp thread/number binding). Opaque here by design. */
  readonly channelThreadRef: string;
  readonly contentType: string;
  readonly safeText?: string;
  readonly contentRef?: string;
  /** D-090 I2: identity for dedupe. Same idempotencyKey must never cause a second provider-side send. */
  readonly idempotencyKey: IdempotencyKey;
}

/**
 * Provider-neutral messaging port for outbound sends. `MockMetaWhatsAppPort` is the
 * Lane-A deterministic implementation used until a real Meta-authentic adapter (Lane B,
 * blocked on provider access) can implement the same interface without changing any
 * caller/domain logic.
 */
export interface MetaWhatsAppPort {
  sendMessage(request: MetaWhatsAppSendRequest): Promise<OutboundSendResult>;
}

export interface MetaWhatsAppSendAudit {
  readonly request: MetaWhatsAppSendRequest;
  readonly result: OutboundSendResult;
  readonly replay: boolean;
}

/**
 * Deterministic, fixture-driven mock of the outbound send path. Enforces the same
 * idempotency invariant a real adapter must: a repeated idempotencyKey returns the
 * original result and never re-invokes the (mock) provider effect.
 */
export class MockMetaWhatsAppPort implements MetaWhatsAppPort {
  private readonly sent = new Map<IdempotencyKey, OutboundSendResult>();
  private readonly audit: MetaWhatsAppSendAudit[] = [];
  private effectCount = 0;

  public constructor(
    private readonly behavior: 'ALWAYS_SUCCEED' | 'ALWAYS_FAIL' = 'ALWAYS_SUCCEED',
  ) {}

  public sendMessage(request: MetaWhatsAppSendRequest): Promise<OutboundSendResult> {
    const existing = this.sent.get(request.idempotencyKey);
    if (existing) {
      this.audit.push({ request, result: existing, replay: true });
      return Promise.resolve(existing);
    }
    this.effectCount += 1;
    const result: OutboundSendResult =
      this.behavior === 'ALWAYS_FAIL'
        ? { status: 'FAILED' }
        : {
            status: 'SUCCEEDED',
            providerMessageRef: `mock-send-${request.idempotencyKey}`,
          };
    this.sent.set(request.idempotencyKey, result);
    this.audit.push({ request, result, replay: false });
    return Promise.resolve(result);
  }

  /** Number of distinct provider-side effects actually performed (excludes idempotent replays). */
  public getEffectCount(): number {
    return this.effectCount;
  }

  public getAudit(): readonly MetaWhatsAppSendAudit[] {
    return this.audit;
  }
}

/**
 * Materializes a Message only from a SUCCEEDED send, reusing the same domain-level
 * guarantee `materializeSentMessage` already enforces for every channel: a FAILED
 * OutboundSendResult can never become a sent Message.
 */
export async function sendAndMaterialize(
  port: MetaWhatsAppPort,
  request: MetaWhatsAppSendRequest,
  materialize: (result: OutboundSendResult) => Message,
): Promise<{ readonly result: OutboundSendResult; readonly message?: Message }> {
  const result = await port.sendMessage(request);
  if (result.status !== 'SUCCEEDED') return { result };
  return { result, message: materialize(result) };
}
