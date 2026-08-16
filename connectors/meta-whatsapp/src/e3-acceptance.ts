import type { TestResultState } from '../../../packages/domain/src/evidence-maturity';

export const META_E3_GATE_IDS = [
  'M-01',
  'M-02',
  'M-03',
  'M-04',
  'M-05',
  'M-06',
  'M-07',
  'M-08',
] as const;

export type MetaE3GateId = (typeof META_E3_GATE_IDS)[number];

export type MetaE3GateState = Extract<
  TestResultState,
  'NOT_RUN' | 'PASS' | 'FAIL' | 'BLOCKED_BY_PROVIDER_ACCESS' | 'BLOCKED_BY_OWNER_ACCESS' | 'BLOCKED_BY_ENVIRONMENT'
>;

export interface MetaE3GateDefinition {
  readonly gateId: MetaE3GateId;
  readonly capability: string;
  readonly acceptance: string;
  readonly requiredEvidenceKinds: readonly string[];
  readonly initialState: MetaE3GateState;
}

/**
 * Provider-neutral acceptance registry only.
 * No Meta endpoint, payload schema, signature algorithm, token, app secret, phone number or WABA identifier is encoded here.
 * A PASS is valid only after provider-authentic E3 evidence is captured outside source code and secrets remain external.
 */
export const META_E3_ACCEPTANCE_GATES: readonly MetaE3GateDefinition[] = Object.freeze([
  {
    gateId: 'M-01',
    capability: 'app_and_business_eligibility',
    acceptance: 'Current app/business eligibility and required permission state are recorded without secrets.',
    requiredEvidenceKinds: ['provider_readback', 'permission_state', 'captured_at'],
    initialState: 'BLOCKED_BY_OWNER_ACCESS',
  },
  {
    gateId: 'M-02',
    capability: 'embedded_signup',
    acceptance: 'Controlled onboarding returns merchant-scoped WABA and phone-number identifiers plus integration state.',
    requiredEvidenceKinds: ['provider_readback', 'merchant_scope_binding', 'captured_at'],
    initialState: 'BLOCKED_BY_OWNER_ACCESS',
  },
  {
    gateId: 'M-03',
    capability: 'waba_subscription',
    acceptance: 'The exact WABA is subscribed and provider readback confirms the intended app binding.',
    requiredEvidenceKinds: ['subscription_write_receipt', 'subscription_readback', 'captured_at'],
    initialState: 'BLOCKED_BY_OWNER_ACCESS',
  },
  {
    gateId: 'M-04',
    capability: 'inbound_message',
    acceptance: 'One inbound customer message reaches the intended tenant/integration and duplicate delivery is idempotent.',
    requiredEvidenceKinds: ['inbound_event_ref', 'tenant_resolution_ref', 'idempotency_ref', 'captured_at'],
    initialState: 'BLOCKED_BY_OWNER_ACCESS',
  },
  {
    gateId: 'M-05',
    capability: 'outbound_service_reply',
    acceptance: 'One outbound service reply succeeds through the official provider path with authorized sender context.',
    requiredEvidenceKinds: ['outbound_operation_ref', 'provider_readback', 'authorized_sender_ref', 'captured_at'],
    initialState: 'BLOCKED_BY_OWNER_ACCESS',
  },
  {
    gateId: 'M-06',
    capability: 'message_status_reconciliation',
    acceptance: 'A status callback is observed and reconciliation remains correct when receipt order differs from source timestamps.',
    requiredEvidenceKinds: ['status_event_refs', 'source_timestamp_ordering_ref', 'reconciliation_ref', 'captured_at'],
    initialState: 'BLOCKED_BY_OWNER_ACCESS',
  },
  {
    gateId: 'M-07',
    capability: 'disconnect_revoke',
    acceptance: 'Disconnect/unsubscribe/revoke is demonstrated and tenant mapping becomes inactive without deleting audit lineage.',
    requiredEvidenceKinds: ['disconnect_operation_ref', 'inactive_mapping_readback', 'audit_lineage_ref', 'captured_at'],
    initialState: 'BLOCKED_BY_OWNER_ACCESS',
  },
  {
    gateId: 'M-08',
    capability: 'secret_and_credential_hygiene',
    acceptance: 'Credentials and tokens are absent from Drive, model prompts, fixtures, logs and evaluation payloads.',
    requiredEvidenceKinds: ['secret_scan_ref', 'log_redaction_ref', 'evaluation_redaction_ref', 'captured_at'],
    initialState: 'BLOCKED_BY_OWNER_ACCESS',
  },
]);
