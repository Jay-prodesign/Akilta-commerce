import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.env.AI_COMMERCE_REPO_ROOT || process.cwd();
const template = JSON.parse(fs.readFileSync(path.join(root, 'release/META_E3_ACCEPTANCE_TEMPLATE_20260808.json'), 'utf8'));
const source = fs.readFileSync(path.join(root, 'connectors/meta-whatsapp/src/e3-acceptance.ts'), 'utf8');

let passed = 0;
const check = (condition, message) => { assert.ok(condition, message); passed += 1; };

check(template.maturity_target === 'E3_PROVIDER_AUTHENTIC_PASS', 'must target E3 only');
check(template.release_effect === 'NO_RELEASE_PASS_BY_TEMPLATE', 'template must not release');
check(template.overall_state === 'BLOCKED_BY_OWNER_ACCESS', 'initial state must remain blocked');
check(template.gates.length === 8, 'exactly eight Meta gates required');
check(template.gates.map(g => g.gate_id).join(',') === 'M-01,M-02,M-03,M-04,M-05,M-06,M-07,M-08', 'gate order/id mismatch');
check(template.gates.every(g => g.state === 'BLOCKED_BY_OWNER_ACCESS'), 'no gate may start PASS');
check(template.gates.every(g => Array.isArray(g.evidence_refs) && g.evidence_refs.length === 0), 'template evidence refs must start empty');
check(template.gates.every(g => g.provider_readback_ref === null), 'provider readback must not be fabricated');
check(template.gates.every(g => g.captured_at === null), 'capture time must not be fabricated');
check(template.secret_handling.raw_credentials_allowed_in_drive === false, 'Drive secret ban required');
check(template.secret_handling.raw_credentials_allowed_in_model_prompts === false, 'model prompt secret ban required');
check(template.secret_handling.raw_credentials_allowed_in_fixtures === false, 'fixture secret ban required');
check(template.secret_handling.raw_credentials_allowed_in_logs === false, 'log secret ban required');
check(!JSON.stringify(template).match(/access[_-]?token|client[_-]?secret|app[_-]?secret|bearer\s+[a-z0-9._-]+/i), 'template must contain no secret-like value');
check(source.includes("'M-01'") && source.includes("'M-08'"), 'source registry must span M-01..M-08');
check(source.includes('BLOCKED_BY_OWNER_ACCESS'), 'source registry must fail closed before access');
check(source.includes('No Meta endpoint, payload schema, signature algorithm, token, app secret, phone number or WABA identifier is encoded here.'), 'source must prohibit provider-schema guessing');
check(template.production_claim === 'NOT_PRODUCTION_READY', 'template must not imply production readiness');

console.log(`meta e3 acceptance template: ${passed}/18 PASS`);
