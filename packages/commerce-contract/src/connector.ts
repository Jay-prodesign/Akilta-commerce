import { assertNonEmptyString } from '../../domain/src/brand';
import type { IntegrationId, MerchantWorkspaceId, SupportState, UtcTimestamp } from '../../domain/src';

export const CONNECTOR_OPERATION_IDS = [
  'validate_credentials',
  'get_health',
  'get_capabilities',
  'sync_catalog_incremental',
  'reconcile_catalog',
  'search_products',
  'get_product',
  'get_variant',
  'get_inventory',
  'get_order',
  'get_order_status',
  'get_fulfillment',
  'get_tracking',
  'verify_customer_order_access',
  'process_webhook',
  'normalize_webhook_event',
  'disconnect',
] as const;

export type ConnectorOperationId = (typeof CONNECTOR_OPERATION_IDS)[number];

export const CONNECTOR_RESULT_STATUSES = [
  'OK',
  'NOT_FOUND',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'UNSUPPORTED',
  'BLOCKED_BY_ACCESS',
  'TEMPORARILY_UNAVAILABLE',
  'RATE_LIMITED',
  'STALE',
  'INVALID_SOURCE_DATA',
  'PROVIDER_ERROR',
] as const;

export type ConnectorResultStatus = (typeof CONNECTOR_RESULT_STATUSES)[number];

export interface ConnectorCapability {
  readonly operationId: ConnectorOperationId;
  readonly supportState: SupportState;
  readonly evidenceRef?: string;
  readonly lastVerifiedAt?: UtcTimestamp;
  readonly limitations: readonly string[];
}

export interface ConnectorIdentity {
  readonly provider: string;
  readonly connectorVersion: string;
  readonly apiVersionState: 'UNKNOWN' | 'EVIDENCE_REQUIRED' | 'VERIFIED';
  readonly environment: 'STAGING' | 'PRODUCTION';
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly integrationId: IntegrationId;
}

export interface ConnectorResult<T> {
  readonly status: ConnectorResultStatus;
  readonly data?: T;
  readonly evidenceRefs: readonly string[];
  readonly warnings: readonly string[];
  readonly retryable: boolean;
  readonly retrievedAt: UtcTimestamp;
}

const EVIDENCE_REQUIRED_STATES = new Set<SupportState>(['AVAILABLE', 'UNSUPPORTED', 'STALE']);

export function connectorCapability(input: ConnectorCapability): ConnectorCapability {
  if (EVIDENCE_REQUIRED_STATES.has(input.supportState) && !input.evidenceRef) {
    throw new Error(`CONNECTOR_CAPABILITY_EVIDENCE_REQUIRED:${input.operationId}:${input.supportState}`);
  }
  return Object.freeze({
    operationId: input.operationId,
    supportState: input.supportState,
    ...(input.evidenceRef
      ? { evidenceRef: assertNonEmptyString(input.evidenceRef, 'ConnectorCapability.evidenceRef') }
      : {}),
    ...(input.lastVerifiedAt !== undefined ? { lastVerifiedAt: input.lastVerifiedAt } : {}),
    limitations: Object.freeze([...input.limitations]),
  });
}

export interface CommerceConnectorAdapter {
  readonly identity: ConnectorIdentity;
  getCapabilities(): readonly ConnectorCapability[];
  execute<T>(operationId: ConnectorOperationId, normalizedInput: unknown): Promise<ConnectorResult<T>>;
}

/**
 * Placeholder used before exact provider schema/auth evidence exists.
 * It deliberately cannot parse provider payloads or execute provider calls.
 */
export class EvidenceGatedCommerceConnectorStub implements CommerceConnectorAdapter {
  public constructor(
    public readonly identity: ConnectorIdentity,
    private readonly capabilities: readonly ConnectorCapability[],
    private readonly now: () => UtcTimestamp,
  ) {}

  public getCapabilities(): readonly ConnectorCapability[] {
    return this.capabilities;
  }

  public async execute<T>(operationId: ConnectorOperationId, _normalizedInput: unknown): Promise<ConnectorResult<T>> {
    const capability = this.capabilities.find((item) => item.operationId === operationId);
    return {
      status: capability?.supportState === 'UNSUPPORTED' ? 'UNSUPPORTED' : 'BLOCKED_BY_ACCESS',
      evidenceRefs: capability?.evidenceRef ? [capability.evidenceRef] : [],
      warnings: [
        capability
          ? `Provider-authentic implementation is not admitted for ${operationId} while support state is ${capability.supportState}.`
          : `No capability record exists for ${operationId}.`,
      ],
      retryable: false,
      retrievedAt: this.now(),
    };
  }
}
