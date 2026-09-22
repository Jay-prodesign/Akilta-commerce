import fs from 'node:fs';
import assert from 'node:assert/strict';

const path = process.argv[2] ?? new URL('./INTERNAL_DOGFOOD_AUTH_PERIMETER_ADMISSION_20260809.json', import.meta.url).pathname;
const t = JSON.parse(fs.readFileSync(path, 'utf8'));
let passed = 0;
const ok = (condition, message) => { assert.ok(condition, message); passed += 1; };

ok(t.schema_version === '1.0', 'schema version');
ok(t.overall_state === 'NOT_RUN', 'template must default NOT_RUN');
ok(t.scope === 'OWNED_INTERNAL_DOGFOOD_ONLY', 'scope must be internal dogfood only');
ok(t.customer_iam_vendor_selected === false, 'must not select customer IAM vendor');
ok(t.selected_perimeter_mode === null, 'perimeter mode must remain unselected initially');
ok(Array.isArray(t.candidate_modes) && t.candidate_modes.length >= 2, 'candidate modes must be explicit');
ok(t.secrets_or_customer_pii_allowed === false, 'secrets/PII forbidden');
ok(Array.isArray(t.admission_criteria) && t.admission_criteria.length === 12, 'exact criteria count');
ok(new Set(t.admission_criteria.map(x => x.id)).size === 12, 'criterion ids unique');
ok(t.admission_criteria.every(x => x.state === 'NOT_RUN'), 'all criteria default NOT_RUN');
ok(t.admission_criteria.every(x => Array.isArray(x.evidence_refs) && x.evidence_refs.length === 0), 'no fabricated evidence refs');
ok(t.admission_criteria.some(x => x.criterion.includes('cannot_grant_merchant_workspace')), 'external claim cannot grant workspace authority');
ok(t.admission_criteria.some(x => x.criterion.includes('revocation_denies_authorization')), 'internal revocation must override valid perimeter session');
ok(t.admission_criteria.some(x => x.criterion.includes('outage_fails_closed')), 'outage must fail closed');
ok(t.admission_criteria.some(x => x.criterion.includes('break_glass_path_remains_separate')), 'break-glass separation');
ok(t.promotion_rules.admission_pass_requires_all_criteria_pass === true, 'all criteria required');
ok(t.promotion_rules.external_design_partner_auth_requires_separate_managed_customer_iam_selection_gate === true, 'external pilot auth remains separate gate');
ok(t.promotion_rules.admission_pass_does_not_imply_provider_e3_runtime_recovery_e4_e5_or_e6 === true, 'no maturity escalation by template');

console.log(`internal-dogfood-auth-perimeter-admission: ${passed}/18 PASS`);
