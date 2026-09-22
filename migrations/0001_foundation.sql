-- AI Commerce CR-V1 foundation migration staging draft.
-- PostgreSQL-oriented, provider-independent. No provider raw payload schema and no secret values.
-- Append-only semantics are enforced primarily by repository permissions/interfaces in the first wave.

BEGIN;

CREATE TABLE organizations (
  organization_id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('STANDALONE_MERCHANT','AGENCY','PLATFORM_INTERNAL')),
  display_name TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE merchant_workspaces (
  merchant_workspace_id TEXT PRIMARY KEY,
  owning_organization_id TEXT NOT NULL REFERENCES organizations(organization_id) ON DELETE RESTRICT,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL,
  locale_default TEXT NOT NULL,
  timezone TEXT NOT NULL,
  onboarding_state TEXT NOT NULL,
  security_policy_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (merchant_workspace_id, owning_organization_id)
);

CREATE TABLE users (
  user_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  display_name_safe TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE user_identities (
  user_identity_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  provider TEXT NOT NULL,
  provider_subject_ref TEXT NOT NULL,
  assurance_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (provider, provider_subject_ref)
);

CREATE TABLE auth_organization_bindings (
  auth_organization_binding_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  external_org_ref TEXT NOT NULL,
  internal_organization_id TEXT NOT NULL REFERENCES organizations(organization_id) ON DELETE RESTRICT,
  status TEXT NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL,
  source_ref TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (provider, external_org_ref)
);
CREATE INDEX auth_org_bindings_internal_org_status_idx
  ON auth_organization_bindings(internal_organization_id, status);

CREATE TABLE memberships (
  membership_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  organization_id TEXT NOT NULL REFERENCES organizations(organization_id) ON DELETE RESTRICT,
  status TEXT NOT NULL,
  valid_from TIMESTAMPTZ,
  valid_to TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_from <= valid_to)
);
CREATE INDEX memberships_org_status_idx ON memberships(organization_id, status);
CREATE INDEX memberships_user_status_idx ON memberships(user_id, status);

CREATE TABLE membership_roles (
  membership_id TEXT NOT NULL REFERENCES memberships(membership_id) ON DELETE RESTRICT,
  role_key TEXT NOT NULL,
  PRIMARY KEY (membership_id, role_key)
);

CREATE TABLE agency_client_assignments (
  assignment_id TEXT PRIMARY KEY,
  agency_org_id TEXT NOT NULL REFERENCES organizations(organization_id) ON DELETE RESTRICT,
  merchant_workspace_id TEXT NOT NULL REFERENCES merchant_workspaces(merchant_workspace_id) ON DELETE RESTRICT,
  status TEXT NOT NULL,
  allowed_modules JSONB NOT NULL DEFAULT '[]'::jsonb,
  permission_override_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  approval_authority_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  data_access_level TEXT,
  valid_from TIMESTAMPTZ,
  valid_to TIMESTAMPTZ,
  created_by TEXT,
  reason_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_from <= valid_to)
);
CREATE INDEX agency_assignments_workspace_status_idx ON agency_client_assignments(merchant_workspace_id, status);
CREATE INDEX agency_assignments_agency_status_idx ON agency_client_assignments(agency_org_id, status);

CREATE TABLE integrations (
  integration_id TEXT PRIMARY KEY,
  merchant_workspace_id TEXT NOT NULL REFERENCES merchant_workspaces(merchant_workspace_id) ON DELETE RESTRICT,
  provider TEXT NOT NULL,
  integration_type TEXT NOT NULL,
  status TEXT NOT NULL,
  external_account_ref TEXT,
  credential_reference TEXT,
  last_verified_at TIMESTAMPTZ,
  last_health_at TIMESTAMPTZ,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (integration_id, merchant_workspace_id)
);
CREATE INDEX integrations_workspace_type_status_idx ON integrations(merchant_workspace_id, integration_type, provider, status);

CREATE TABLE integration_capabilities (
  capability_record_id TEXT PRIMARY KEY,
  integration_id TEXT NOT NULL,
  merchant_workspace_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  support_state TEXT NOT NULL CHECK (support_state IN ('UNKNOWN','UNSUPPORTED','AVAILABLE','STALE','ERROR','BLOCKED_BY_ACCESS')),
  read_write_mode TEXT NOT NULL,
  evidence_ref TEXT,
  last_verified_at TIMESTAMPTZ,
  limitations_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (integration_id, operation_id),
  FOREIGN KEY (integration_id, merchant_workspace_id)
    REFERENCES integrations(integration_id, merchant_workspace_id) ON DELETE RESTRICT
);

CREATE TABLE customers (
  customer_id TEXT PRIMARY KEY,
  merchant_workspace_id TEXT NOT NULL REFERENCES merchant_workspaces(merchant_workspace_id) ON DELETE RESTRICT,
  safe_display_name TEXT,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (customer_id, merchant_workspace_id)
);

CREATE TABLE customer_identities (
  customer_identity_id TEXT PRIMARY KEY,
  merchant_workspace_id TEXT NOT NULL REFERENCES merchant_workspaces(merchant_workspace_id) ON DELETE RESTRICT,
  channel_type TEXT NOT NULL,
  normalized_identifier_ref TEXT NOT NULL,
  provider_identifier_ref TEXT,
  customer_id TEXT,
  verification_level TEXT NOT NULL CHECK (verification_level IN ('CV0','CV1','CV2','CV3')),
  verification_expires_at TIMESTAMPTZ,
  match_evidence_ref TEXT,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (customer_identity_id, merchant_workspace_id),
  FOREIGN KEY (customer_id, merchant_workspace_id)
    REFERENCES customers(customer_id, merchant_workspace_id) ON DELETE RESTRICT
);
CREATE INDEX customer_identity_lookup_idx ON customer_identities(merchant_workspace_id, channel_type, normalized_identifier_ref);

CREATE TABLE customer_verification_events (
  verification_event_id TEXT PRIMARY KEY,
  customer_identity_id TEXT NOT NULL,
  merchant_workspace_id TEXT NOT NULL,
  prior_level TEXT,
  new_level TEXT NOT NULL CHECK (new_level IN ('CV0','CV1','CV2','CV3')),
  method TEXT NOT NULL,
  evidence_ref TEXT,
  expires_at TIMESTAMPTZ,
  result TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  FOREIGN KEY (customer_identity_id, merchant_workspace_id)
    REFERENCES customer_identities(customer_identity_id, merchant_workspace_id) ON DELETE RESTRICT
);

CREATE TABLE conversations (
  conversation_id TEXT PRIMARY KEY,
  merchant_workspace_id TEXT NOT NULL REFERENCES merchant_workspaces(merchant_workspace_id) ON DELETE RESTRICT,
  integration_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  channel_thread_ref TEXT NOT NULL,
  customer_identity_id TEXT,
  ownership_state TEXT NOT NULL CHECK (ownership_state IN ('AI_ACTIVE','HANDOFF_REQUESTED','HUMAN_ASSIGNED','HUMAN_ACTIVE','AI_SUGGEST_ONLY','RETURN_TO_AI_PENDING','AI_ACTIVE_RESTORED','CLOSED')),
  ownership_epoch BIGINT NOT NULL DEFAULT 0 CHECK (ownership_epoch >= 0),
  assigned_user_id TEXT REFERENCES users(user_id) ON DELETE RESTRICT,
  status TEXT NOT NULL,
  locale TEXT NOT NULL,
  last_message_at TIMESTAMPTZ,
  last_customer_message_at TIMESTAMPTZ,
  last_outbound_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (conversation_id, merchant_workspace_id),
  UNIQUE (integration_id, channel_thread_ref),
  FOREIGN KEY (integration_id, merchant_workspace_id)
    REFERENCES integrations(integration_id, merchant_workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (customer_identity_id, merchant_workspace_id)
    REFERENCES customer_identities(customer_identity_id, merchant_workspace_id) ON DELETE RESTRICT
);
CREATE INDEX conversations_workspace_last_message_idx ON conversations(merchant_workspace_id, last_message_at DESC);
CREATE INDEX conversations_assignment_status_idx ON conversations(assigned_user_id, status);
CREATE INDEX conversations_ownership_state_idx ON conversations(ownership_state);

CREATE TABLE messages (
  message_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  merchant_workspace_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('INBOUND','OUTBOUND')),
  sender_type TEXT NOT NULL CHECK (sender_type IN ('CUSTOMER','AI','HUMAN','SYSTEM')),
  channel_message_ref TEXT,
  content_type TEXT NOT NULL,
  safe_text TEXT,
  content_ref TEXT,
  received_or_sent_at TIMESTAMPTZ NOT NULL,
  provider_status TEXT,
  reply_to_message_id TEXT,
  action_id TEXT,
  final_send_actor TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  FOREIGN KEY (conversation_id, merchant_workspace_id)
    REFERENCES conversations(conversation_id, merchant_workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (reply_to_message_id) REFERENCES messages(message_id) ON DELETE RESTRICT
);
CREATE INDEX messages_conversation_time_idx ON messages(conversation_id, received_or_sent_at);

CREATE TABLE message_drafts (
  draft_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  merchant_workspace_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('AI','HUMAN')),
  proposed_text TEXT,
  content_ref TEXT,
  approved_fact_set_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('DRAFT','SUPERSEDED','SENT','DISCARDED')),
  created_by TEXT,
  resulting_message_id TEXT REFERENCES messages(message_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  FOREIGN KEY (conversation_id, merchant_workspace_id)
    REFERENCES conversations(conversation_id, merchant_workspace_id) ON DELETE RESTRICT
);

CREATE TABLE conversation_ownership_events (
  ownership_event_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  merchant_workspace_id TEXT NOT NULL,
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  from_epoch BIGINT NOT NULL,
  to_epoch BIGINT NOT NULL,
  actor_ref TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CHECK (to_epoch = from_epoch + 1),
  FOREIGN KEY (conversation_id, merchant_workspace_id)
    REFERENCES conversations(conversation_id, merchant_workspace_id) ON DELETE RESTRICT
);

CREATE TABLE products (
  product_id TEXT PRIMARY KEY,
  merchant_workspace_id TEXT NOT NULL REFERENCES merchant_workspaces(merchant_workspace_id) ON DELETE RESTRICT,
  integration_id TEXT NOT NULL,
  provider_product_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  product_url TEXT,
  source_timestamp TIMESTAMPTZ,
  observed_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (integration_id, provider_product_id),
  UNIQUE (product_id, merchant_workspace_id),
  UNIQUE (product_id, integration_id, merchant_workspace_id),
  FOREIGN KEY (integration_id, merchant_workspace_id)
    REFERENCES integrations(integration_id, merchant_workspace_id) ON DELETE RESTRICT
);

CREATE TABLE variants (
  variant_id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  merchant_workspace_id TEXT NOT NULL,
  integration_id TEXT NOT NULL,
  provider_variant_id TEXT NOT NULL,
  sku TEXT,
  price_amount_minor BIGINT,
  price_currency TEXT,
  compare_at_amount_minor BIGINT,
  compare_at_currency TEXT,
  provider_sellability_state TEXT,
  source_timestamp TIMESTAMPTZ,
  observed_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (integration_id, provider_variant_id),
  UNIQUE (variant_id, merchant_workspace_id),
  UNIQUE (variant_id, integration_id, merchant_workspace_id),
  FOREIGN KEY (product_id, integration_id, merchant_workspace_id)
    REFERENCES products(product_id, integration_id, merchant_workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (integration_id, merchant_workspace_id)
    REFERENCES integrations(integration_id, merchant_workspace_id) ON DELETE RESTRICT
);
CREATE INDEX variants_product_idx ON variants(product_id);
CREATE INDEX variants_workspace_sku_idx ON variants(merchant_workspace_id, sku);

CREATE TABLE variant_options (
  variant_option_id TEXT PRIMARY KEY,
  variant_id TEXT NOT NULL,
  merchant_workspace_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  option_name_exact TEXT NOT NULL,
  option_value_exact TEXT NOT NULL,
  UNIQUE (variant_id, position),
  FOREIGN KEY (variant_id, merchant_workspace_id)
    REFERENCES variants(variant_id, merchant_workspace_id) ON DELETE RESTRICT
);

CREATE TABLE inventory_observations (
  inventory_observation_id TEXT PRIMARY KEY,
  variant_id TEXT NOT NULL,
  merchant_workspace_id TEXT NOT NULL,
  integration_id TEXT NOT NULL,
  location_scope_ref TEXT,
  tracking_state TEXT NOT NULL CHECK (tracking_state IN ('TRACKED','UNTRACKED','UNKNOWN')),
  raw_quantity BIGINT,
  sellable_quantity BIGINT,
  provider_availability TEXT,
  inventory_policy TEXT,
  derived_availability TEXT NOT NULL CHECK (derived_availability IN ('IN_STOCK','OUT_OF_STOCK','AVAILABLE_TO_ORDER','UNKNOWN')),
  derivation_rule_ref TEXT NOT NULL,
  source_timestamp TIMESTAMPTZ,
  observed_at TIMESTAMPTZ NOT NULL,
  freshness_state TEXT NOT NULL,
  evidence_ref TEXT,
  FOREIGN KEY (variant_id, integration_id, merchant_workspace_id)
    REFERENCES variants(variant_id, integration_id, merchant_workspace_id) ON DELETE RESTRICT
);
CREATE INDEX inventory_observations_variant_time_idx ON inventory_observations(variant_id, observed_at DESC);

CREATE TABLE orders (
  order_id TEXT PRIMARY KEY,
  merchant_workspace_id TEXT NOT NULL REFERENCES merchant_workspaces(merchant_workspace_id) ON DELETE RESTRICT,
  integration_id TEXT NOT NULL,
  provider_order_id TEXT NOT NULL,
  display_order_ref TEXT NOT NULL,
  customer_id TEXT,
  provider_customer_ref TEXT,
  order_status TEXT NOT NULL,
  payment_status TEXT NOT NULL,
  currency TEXT NOT NULL,
  total_amount_minor BIGINT,
  provider_created_at TIMESTAMPTZ NOT NULL,
  provider_updated_at TIMESTAMPTZ,
  completeness_scope TEXT NOT NULL CHECK (completeness_scope IN ('FULL_HISTORY','BOUNDED_HISTORY','UNKNOWN')),
  completeness_evidence_ref TEXT,
  observed_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (integration_id, provider_order_id),
  UNIQUE (order_id, merchant_workspace_id),
  FOREIGN KEY (integration_id, merchant_workspace_id)
    REFERENCES integrations(integration_id, merchant_workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (customer_id, merchant_workspace_id)
    REFERENCES customers(customer_id, merchant_workspace_id) ON DELETE RESTRICT,
  CHECK (completeness_scope <> 'FULL_HISTORY' OR completeness_evidence_ref IS NOT NULL)
);
CREATE INDEX orders_workspace_display_ref_idx ON orders(merchant_workspace_id, display_order_ref);
CREATE INDEX orders_customer_created_idx ON orders(customer_id, provider_created_at DESC);

CREATE TABLE order_lines (
  order_line_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  merchant_workspace_id TEXT NOT NULL,
  provider_line_id TEXT NOT NULL,
  product_id TEXT,
  variant_id TEXT,
  title_snapshot TEXT NOT NULL,
  quantity BIGINT NOT NULL CHECK (quantity > 0),
  amount_minor BIGINT,
  currency TEXT,
  UNIQUE (order_id, provider_line_id),
  FOREIGN KEY (order_id, merchant_workspace_id)
    REFERENCES orders(order_id, merchant_workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (product_id, merchant_workspace_id)
    REFERENCES products(product_id, merchant_workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (variant_id, merchant_workspace_id)
    REFERENCES variants(variant_id, merchant_workspace_id) ON DELETE RESTRICT
);

CREATE TABLE fulfillments (
  fulfillment_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  merchant_workspace_id TEXT NOT NULL,
  provider_fulfillment_id TEXT NOT NULL,
  status TEXT NOT NULL,
  source_timestamp TIMESTAMPTZ,
  observed_at TIMESTAMPTZ NOT NULL,
  UNIQUE (order_id, provider_fulfillment_id),
  FOREIGN KEY (order_id, merchant_workspace_id)
    REFERENCES orders(order_id, merchant_workspace_id) ON DELETE RESTRICT,
  UNIQUE (fulfillment_id, merchant_workspace_id)
);

CREATE TABLE shipments (
  shipment_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  fulfillment_id TEXT,
  merchant_workspace_id TEXT NOT NULL,
  provider_shipment_id TEXT,
  carrier TEXT,
  tracking_number_ref TEXT,
  tracking_url TEXT,
  status TEXT NOT NULL,
  shipped_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  source_timestamp TIMESTAMPTZ,
  observed_at TIMESTAMPTZ NOT NULL,
  FOREIGN KEY (order_id, merchant_workspace_id)
    REFERENCES orders(order_id, merchant_workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (fulfillment_id, merchant_workspace_id)
    REFERENCES fulfillments(fulfillment_id, merchant_workspace_id) ON DELETE RESTRICT
);

CREATE TABLE knowledge_sources (
  knowledge_source_id TEXT PRIMARY KEY,
  merchant_workspace_id TEXT NOT NULL REFERENCES merchant_workspaces(merchant_workspace_id) ON DELETE RESTRICT,
  source_type TEXT NOT NULL,
  authority_class TEXT NOT NULL,
  status TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  source_ref TEXT NOT NULL,
  freshness_state TEXT NOT NULL,
  approved_by_ref TEXT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (knowledge_source_id, merchant_workspace_id)
);

CREATE TABLE knowledge_items (
  knowledge_item_id TEXT PRIMARY KEY,
  knowledge_source_id TEXT NOT NULL,
  merchant_workspace_id TEXT NOT NULL,
  fact_class TEXT NOT NULL,
  fact_key TEXT NOT NULL,
  safe_content TEXT,
  content_ref TEXT,
  approval_state TEXT NOT NULL,
  valid_from TIMESTAMPTZ,
  valid_to TIMESTAMPTZ,
  supersedes_item_id TEXT,
  conflict_state TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  FOREIGN KEY (knowledge_source_id, merchant_workspace_id)
    REFERENCES knowledge_sources(knowledge_source_id, merchant_workspace_id) ON DELETE RESTRICT
);
CREATE INDEX knowledge_items_fact_idx ON knowledge_items(merchant_workspace_id, fact_class, approval_state);

CREATE TABLE merchant_rules (
  merchant_rule_id TEXT PRIMARY KEY,
  merchant_workspace_id TEXT NOT NULL REFERENCES merchant_workspaces(merchant_workspace_id) ON DELETE RESTRICT,
  scope_key TEXT NOT NULL,
  intent TEXT NOT NULL,
  status TEXT NOT NULL,
  current_version_id TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (merchant_rule_id, merchant_workspace_id)
);

CREATE TABLE merchant_rule_versions (
  merchant_rule_version_id TEXT PRIMARY KEY,
  merchant_rule_id TEXT NOT NULL,
  merchant_workspace_id TEXT NOT NULL,
  version_number INTEGER NOT NULL CHECK (version_number >= 1),
  conditions_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  behavior_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  authority_class TEXT NOT NULL,
  source_actor_ref TEXT,
  source_ref TEXT NOT NULL,
  risk_class TEXT NOT NULL,
  approval_state TEXT NOT NULL,
  lifecycle_state TEXT NOT NULL,
  effective_from TIMESTAMPTZ,
  effective_to TIMESTAMPTZ,
  supersedes_version_id TEXT,
  rollback_target_version_id TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (merchant_rule_id, version_number),
  FOREIGN KEY (merchant_rule_id, merchant_workspace_id)
    REFERENCES merchant_rules(merchant_rule_id, merchant_workspace_id) ON DELETE RESTRICT
);
ALTER TABLE merchant_rules ADD CONSTRAINT merchant_rules_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES merchant_rule_versions(merchant_rule_version_id) ON DELETE RESTRICT;

CREATE TABLE rule_conflicts (
  rule_conflict_id TEXT PRIMARY KEY,
  merchant_workspace_id TEXT NOT NULL REFERENCES merchant_workspaces(merchant_workspace_id) ON DELETE RESTRICT,
  rule_refs JSONB NOT NULL,
  conflict_type TEXT NOT NULL,
  authority_comparison JSONB NOT NULL,
  status TEXT NOT NULL,
  resolution_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ
);

CREATE TABLE operational_events (
  event_id TEXT PRIMARY KEY,
  merchant_workspace_id TEXT NOT NULL REFERENCES merchant_workspaces(merchant_workspace_id) ON DELETE RESTRICT,
  integration_id TEXT,
  event_type TEXT NOT NULL,
  source TEXT NOT NULL,
  source_event_id TEXT,
  source_timestamp TIMESTAMPTZ,
  observed_at TIMESTAMPTZ NOT NULL,
  correlation_id TEXT NOT NULL,
  causation_event_id TEXT,
  idempotency_key TEXT,
  payload_type TEXT,
  safe_payload_json JSONB,
  payload_ref TEXT,
  processing_state TEXT NOT NULL,
  FOREIGN KEY (integration_id, merchant_workspace_id)
    REFERENCES integrations(integration_id, merchant_workspace_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX operational_events_source_event_uq
  ON operational_events(merchant_workspace_id, integration_id, source, source_event_id)
  WHERE source_event_id IS NOT NULL;
CREATE UNIQUE INDEX operational_events_idempotency_uq
  ON operational_events(merchant_workspace_id, event_type, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX operational_events_workspace_time_idx ON operational_events(merchant_workspace_id, observed_at);
CREATE INDEX operational_events_correlation_idx ON operational_events(correlation_id);

CREATE TABLE audit_events (
  audit_event_id TEXT PRIMARY KEY,
  merchant_workspace_id TEXT NOT NULL REFERENCES merchant_workspaces(merchant_workspace_id) ON DELETE RESTRICT,
  actor_user_id TEXT,
  acting_org_id TEXT,
  resource_type TEXT NOT NULL,
  resource_ref TEXT,
  action TEXT NOT NULL,
  decision TEXT NOT NULL,
  matched_policy_permission_ref TEXT,
  request_id TEXT,
  run_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  result_code TEXT NOT NULL,
  error_code TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  sensitivity_class TEXT
);
CREATE INDEX audit_events_workspace_time_idx ON audit_events(merchant_workspace_id, occurred_at);
CREATE INDEX audit_events_run_corr_idx ON audit_events(run_id, correlation_id);

CREATE TABLE evaluation_events (
  evaluation_event_id TEXT PRIMARY KEY,
  merchant_workspace_id TEXT NOT NULL REFERENCES merchant_workspaces(merchant_workspace_id) ON DELETE RESTRICT,
  run_id TEXT NOT NULL,
  parent_event_id TEXT,
  stage TEXT NOT NULL CHECK (stage IN ('INPUT','RETRIEVAL','FIRST_OUTPUT','CHECK','CORRECTION','FINAL_OUTPUT','EXECUTION','POST_READ','OUTCOME')),
  model_ref TEXT,
  tool_ref TEXT,
  version_ref TEXT,
  error_code TEXT,
  training_eligibility TEXT NOT NULL DEFAULT 'NOT_CLASSIFIED',
  privacy_classification TEXT NOT NULL,
  redaction_state TEXT NOT NULL,
  safe_payload_json JSONB,
  payload_ref TEXT,
  retention_policy_ref TEXT,
  occurred_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX evaluation_events_workspace_run_stage_idx ON evaluation_events(merchant_workspace_id, run_id, stage, occurred_at);

CREATE TABLE usage_events (
  usage_event_id TEXT PRIMARY KEY,
  merchant_workspace_id TEXT NOT NULL REFERENCES merchant_workspaces(merchant_workspace_id) ON DELETE RESTRICT,
  module TEXT NOT NULL,
  run_id TEXT,
  correlation_id TEXT,
  logical_operation_ref TEXT NOT NULL,
  provider_type TEXT NOT NULL,
  provider_operation TEXT NOT NULL,
  quantity BIGINT NOT NULL,
  unit TEXT NOT NULL,
  rate_card_version TEXT NOT NULL,
  provider_cost_amount_minor BIGINT,
  provider_cost_currency TEXT,
  estimated_flag BOOLEAN NOT NULL,
  reconciliation_state TEXT NOT NULL,
  provider_usage_ref TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  UNIQUE (merchant_workspace_id, module, logical_operation_ref)
);
CREATE INDEX usage_events_workspace_time_idx ON usage_events(merchant_workspace_id, occurred_at);

CREATE TABLE action_plans (
  action_plan_id TEXT PRIMARY KEY,
  merchant_workspace_id TEXT NOT NULL REFERENCES merchant_workspaces(merchant_workspace_id) ON DELETE RESTRICT,
  action_name TEXT NOT NULL,
  action_version TEXT NOT NULL,
  actor_user_id TEXT,
  system_actor TEXT,
  exact_payload_json JSONB NOT NULL,
  payload_hash TEXT NOT NULL,
  evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  risk_class TEXT NOT NULL,
  provider_capability_snapshot_ref TEXT,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  correlation_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  UNIQUE (action_plan_id, merchant_workspace_id)
);

CREATE TABLE approval_requests (
  approval_request_id TEXT PRIMARY KEY,
  action_plan_id TEXT NOT NULL,
  merchant_workspace_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  required_approver_permission TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','APPROVED','REJECTED','EXPIRED','EXECUTED','INVALIDATED')),
  expires_at TIMESTAMPTZ NOT NULL,
  decision_actor_ref TEXT,
  decision_at TIMESTAMPTZ,
  reason_ref TEXT,
  executed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  FOREIGN KEY (action_plan_id, merchant_workspace_id)
    REFERENCES action_plans(action_plan_id, merchant_workspace_id) ON DELETE RESTRICT
);

CREATE TABLE action_executions (
  action_execution_id TEXT PRIMARY KEY,
  action_plan_id TEXT NOT NULL,
  merchant_workspace_id TEXT NOT NULL,
  action_namespace TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL,
  provider_result_ref TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  error_code TEXT,
  post_read_state TEXT,
  compensation_state TEXT,
  UNIQUE (merchant_workspace_id, action_namespace, idempotency_key),
  FOREIGN KEY (action_plan_id, merchant_workspace_id)
    REFERENCES action_plans(action_plan_id, merchant_workspace_id) ON DELETE RESTRICT
);

CREATE TABLE workspace_readiness (
  merchant_workspace_id TEXT PRIMARY KEY REFERENCES merchant_workspaces(merchant_workspace_id) ON DELETE RESTRICT,
  identity_admin_state TEXT NOT NULL,
  whatsapp_integration_state TEXT NOT NULL,
  commerce_integration_state TEXT NOT NULL,
  knowledge_policy_state TEXT NOT NULL,
  merchant_rules_state TEXT NOT NULL,
  test_conversation_state TEXT NOT NULL,
  security_baseline_state TEXT NOT NULL,
  usage_visibility_state TEXT NOT NULL,
  overall_state TEXT NOT NULL,
  evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  computed_at TIMESTAMPTZ NOT NULL,
  version BIGINT NOT NULL DEFAULT 1 CHECK (version >= 1)
);

COMMIT;
