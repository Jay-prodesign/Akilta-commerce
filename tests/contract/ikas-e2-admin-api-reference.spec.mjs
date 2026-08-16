import fs from 'node:fs';

const file = process.argv[2];
if (!file) throw new Error('evidence file required');
const e = JSON.parse(fs.readFileSync(file, 'utf8'));

const checks = [];
function check(label, condition) {
  if (!condition) throw new Error(`FAIL:${label}`);
  checks.push(label);
}

check('E2 only', e.evidence_maturity === 'E2_PROVIDER_REFERENCE');
check('no provider-authentic claim', e.provider_authentic_test === false);
check('no execution admission', e.connector_execution_admitted === false);
check('no support claim', e.support_claim_admitted === false);
check('client credentials', e.authentication.private_app_flow === 'client_credentials');
check('bearer token', e.authentication.token_type === 'Bearer');
check('endpoint distinction flagged', e.authentication.endpoint_evidence_state.includes('E3'));
check('order identity/status fields', ['id','orderNumber','orderedAt','status','totalFinalPrice'].every(x => e.operations.order.fields.includes(x)));
check('order pagination explicit', ['count','hasNext','limit','page'].every(x => e.operations.order.pagination_fields.includes(x)));
check('customer PII explicit', ['id','fullName','email','phone'].every(x => e.operations.customer.fields.includes(x)));
check('variant identity explicit', e.operations.product.stock_write_input_fields.includes('variantId'));
check('location-aware stock', e.operations.product.stock_write_input_fields.includes('stockLocationId'));
check('webhook validation required', e.operations.webhook.validation_required === true);
check('webhook retry count recorded', e.operations.webhook.retry_on_non_200_count === 3);
check('order webhook scope', e.operations.webhook.documented_scopes.includes('store/order/created'));
check('stock webhook scope', e.operations.webhook.documented_scopes.includes('store/stock/updated'));
check('signature algorithm not guessed', e.operations.webhook.signature_exact_algorithm_admitted === false);
check('E3 remains blocked', e.decision === 'E2_SCHEMA_REFERENCE_ACCEPTED_E3_EXECUTION_BLOCKED');

console.log(JSON.stringify({status:'PASS', passed:checks.length, total:checks.length, checks}));
