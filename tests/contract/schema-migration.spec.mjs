import fs from 'node:fs';

const up = fs.readFileSync(new URL('../../migrations/0001_foundation.sql', import.meta.url), 'utf8');
const down = fs.readFileSync(new URL('../../migrations/0001_foundation.preproduction_rollback.sql', import.meta.url), 'utf8');
const expectedTables = [
  'organizations','merchant_workspaces','users','user_identities','auth_organization_bindings','memberships','membership_roles',
  'agency_client_assignments','integrations','integration_capabilities','customers','customer_identities',
  'customer_verification_events','conversations','messages','message_drafts','conversation_ownership_events',
  'products','variants','variant_options','inventory_observations','orders','order_lines','fulfillments','shipments',
  'knowledge_sources','knowledge_items','merchant_rules','merchant_rule_versions','rule_conflicts','operational_events',
  'audit_events','evaluation_events','usage_events','action_plans','approval_requests','action_executions','workspace_readiness',
];
const created = [...up.matchAll(/CREATE TABLE\s+([a-z_]+)/g)].map((m) => m[1]);
const dropped = [...down.matchAll(/DROP TABLE IF EXISTS\s+([a-z_]+)/g)].map((m) => m[1]);
const scenarios = [
  { id:'DB-FIRST-SET-COVERAGE', actual: expectedTables.every((t)=>created.includes(t)), expected:true },
  { id:'DB-ROLLBACK-COVERS-CREATED-TABLES', actual: created.every((t)=>dropped.includes(t)), expected:true },
  { id:'DB-01-COMPOSITE-TENANT-FK-CONVERSATION-MESSAGE', actual: /FOREIGN KEY \(conversation_id, merchant_workspace_id\)[\s\S]*REFERENCES conversations\(conversation_id, merchant_workspace_id\)/.test(up), expected:true },
  { id:'DB-01-COMPOSITE-TENANT-FK-ORDER-LINE', actual: /FOREIGN KEY \(order_id, merchant_workspace_id\)[\s\S]*REFERENCES orders\(order_id, merchant_workspace_id\)/.test(up), expected:true },
  { id:'DB-02-PROVIDER-ID-SCOPED-BY-INTEGRATION', actual: /UNIQUE \(integration_id, provider_product_id\)/.test(up) && /UNIQUE \(integration_id, provider_variant_id\)/.test(up) && /UNIQUE \(integration_id, provider_order_id\)/.test(up), expected:true },
  { id:'AUTH-ORG-BINDING-ORG-ONLY', actual: /auth_organization_bindings[\s\S]*internal_organization_id TEXT NOT NULL REFERENCES organizations\(organization_id\)/.test(up) && !/auth_organization_bindings[\s\S]{0,600}merchant_workspace_id/.test(up), expected:true },
  { id:'AUTH-ORG-BINDING-EXTERNAL-UNIQUE', actual: /auth_organization_bindings[\s\S]*UNIQUE \(provider, external_org_ref\)/.test(up), expected:true },
  { id:'DB-03-IDEMPOTENCY-UNIQUE', actual: /UNIQUE \(merchant_workspace_id, action_namespace, idempotency_key\)/.test(up) && /operational_events_idempotency_uq/.test(up), expected:true },
  { id:'DB-04-EVALUATION-STAGE-STORABLE', actual: /evaluation_events[\s\S]*NOT_CLASSIFIED/.test(up), expected:true },
  { id:'DB-06-OWNERSHIP-EPOCH-CONSTRAINT', actual: /CHECK \(to_epoch = from_epoch \+ 1\)/.test(up), expected:true },
  { id:'DB-08-PARTIAL-ORDER-COMPLETENESS', actual: /FULL_HISTORY','BOUNDED_HISTORY','UNKNOWN/.test(up) && /completeness_evidence_ref/.test(up), expected:true },
  { id:'DB-09-NO-SECRET-VALUE-COLUMN', actual: !/\b(access_token|refresh_token|password|secret_value|credential_value)\b/i.test(up), expected:true },
  { id:'MONEY-NO-FLOAT', actual: !/\b(REAL|DOUBLE PRECISION|FLOAT)\b/i.test(up) && /amount_minor BIGINT/.test(up), expected:true },
  { id:'ROLLBACK-PREPRODUCTION-GUARD', actual: /PRE-PRODUCTION \/ LOCAL RECOVERY ONLY/.test(down), expected:true },
];
const failed = scenarios.filter((s)=>s.actual!==s.expected);
if(failed.length){ for(const f of failed) console.error('FAIL',f); throw new Error(`${failed.length}/${scenarios.length} schema staging checks failed`); }
console.log(`PASS ${scenarios.length}/${scenarios.length}`);
for(const s of scenarios) console.log(`PASS ${s.id}`);
