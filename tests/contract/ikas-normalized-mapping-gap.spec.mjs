import fs from 'node:fs';
const [evidenceFile, productFile, inventoryFile, orderFile, customerFile, webhookFile] = process.argv.slice(2);
if (![evidenceFile, productFile, inventoryFile, orderFile, customerFile, webhookFile].every(Boolean)) throw new Error('six files required');
const e = JSON.parse(fs.readFileSync(evidenceFile,'utf8'));
const sources = {
  Product: fs.readFileSync(productFile,'utf8'),
  Variant: fs.readFileSync(productFile,'utf8'),
  InventoryObservation: fs.readFileSync(inventoryFile,'utf8'),
  Order: fs.readFileSync(orderFile,'utf8'),
  CustomerIdentity: fs.readFileSync(customerFile,'utf8'),
  WebhookIngressContext: fs.readFileSync(webhookFile,'utf8')
};
let passed=0; const checks=[];
function check(label, cond){ if(!cond) throw new Error(`FAIL:${label}`); passed++; checks.push(label); }
check('E2 only', e.evidence_maturity==='E2_PROVIDER_REFERENCE');
check('no provider-authentic claim', e.provider_authentic_test===false);
check('no adapter mapping admission', e.adapter_mapping_admitted===false);
check('no support claim', e.support_claim_admitted===false);
check('allowed classification set', e.mappings.every(m=>e.classification_values.includes(m.classification)));
check('no customer PII exact-direct', e.mappings.filter(m=>/^customer\.(email|phone|fullName)$/.test(m.provider_field)).every(m=>m.classification==='SENSITIVE_AUTHZ'));
check('order total not direct without currency', e.mappings.find(m=>m.provider_field==='order.totalFinalPrice')?.classification==='UNRESOLVED');
check('stock quantity not availability', e.mappings.find(m=>m.provider_field==='stock.stockCount')?.normalized_target==='InventoryObservation.rawQuantity');
check('sellability unresolved', e.mappings.find(m=>m.provider_field==='inventory.providerAvailability')?.classification==='UNRESOLVED');
check('inventory policy unresolved', e.mappings.find(m=>m.provider_field==='inventory.inventoryPolicy')?.classification==='UNRESOLVED');
check('webhook signature unresolved', e.mappings.find(m=>m.provider_field==='webhook.signature')?.classification==='UNRESOLVED');
check('order completeness derived', e.mappings.find(m=>m.provider_field==='order.pagination')?.classification==='DERIVED_WITH_RULE');
check('no core expansion decision', e.decision==='NORMALIZED_CONTRACT_HOLDS_AT_E2_NO_CORE_EXPANSION_E3_MAPPING_PENDING');
for (const m of e.mappings) {
  const [root, prop] = m.normalized_target.split('.',2);
  if (sources[root] && prop && !prop.includes('display_name') && !prop.includes('async_delivery_policy')) {
    check(`normalized target exists:${m.normalized_target}`, sources[root].includes(prop));
  }
}
console.log(JSON.stringify({status:'PASS',passed,total:passed,checks}));
