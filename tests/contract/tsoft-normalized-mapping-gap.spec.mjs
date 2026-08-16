import fs from 'node:fs';
const [evidenceFile, productFile, inventoryFile, orderFile, customerFile, webhookFile, moneyFile] = process.argv.slice(2);
if (![evidenceFile, productFile, inventoryFile, orderFile, customerFile, webhookFile, moneyFile].every(Boolean)) throw new Error('seven files required');
const e=JSON.parse(fs.readFileSync(evidenceFile,'utf8'));
const src={Product:fs.readFileSync(productFile,'utf8'),Variant:fs.readFileSync(productFile,'utf8'),InventoryObservation:fs.readFileSync(inventoryFile,'utf8'),Order:fs.readFileSync(orderFile,'utf8'),OrderLine:fs.readFileSync(orderFile,'utf8'),Shipment:fs.readFileSync(orderFile,'utf8'),CustomerIdentity:fs.readFileSync(customerFile,'utf8'),WebhookIngressContext:fs.readFileSync(webhookFile,'utf8'),Money:fs.readFileSync(moneyFile,'utf8')};
let passed=0; const checks=[]; function check(l,c){if(!c)throw new Error(`FAIL:${l}`);passed++;checks.push(l)}
check('E2 only',e.evidence_maturity==='E2_PROVIDER_REFERENCE');
check('no provider-authentic claim',e.provider_authentic_test===false);
check('no adapter admission',e.adapter_mapping_admitted===false);
check('no support claim',e.support_claim_admitted===false);
check('order id direct',e.mappings.find(m=>m.provider_field==='OrderId')?.classification==='EXACT_DIRECT');
check('order code direct',e.mappings.find(m=>m.provider_field==='OrderCode')?.classification==='EXACT_DIRECT');
check('order date derived timezone',e.mappings.find(m=>m.provider_field==='OrderDate')?.classification==='DERIVED_WITH_RULE');
check('money derived',e.mappings.find(m=>m.provider_field==='OrderTotalPrice+Currency')?.classification==='DERIVED_WITH_RULE');
check('TL to TRY explicit',e.mappings.find(m=>m.provider_field==='OrderTotalPrice+Currency')?.note.includes('TRY'));
check('customer email sensitive',e.mappings.find(m=>m.provider_field==='CustomerUsername')?.classification==='SENSITIVE_AUTHZ');
check('product code not direct internal id',e.mappings.find(m=>m.provider_field==='ProductCode')?.classification==='DERIVED_WITH_RULE');
check('mutable product ws code unresolved identity',e.mappings.find(m=>m.provider_field==='ProductWebServiceCode')?.classification==='UNRESOLVED');
check('negative stock policy derived',e.mappings.find(m=>m.provider_field==='EksiStokUygulamasi=enabled')?.classification==='DERIVED_WITH_RULE');
check('quantity not sole availability',e.critical_findings.some(x=>x.includes('separation of quantity')));
check('webhook signature unresolved',e.mappings.find(m=>m.provider_field==='X-Hub-Signature')?.classification==='UNRESOLVED');
check('no core expansion',e.decision==='NORMALIZED_CONTRACT_HOLDS_AT_E2_NO_CORE_EXPANSION_E3_MAPPING_PENDING');
check('money contract requires 3 letters',/\^\[A-Z\]\{3\}\$/.test(src.Money) || src.Money.includes('three-letter uppercase ISO-style'));
for(const m of e.mappings){const [root,prop]=m.normalized_target.split('.',2);if(src[root]&&prop&&!prop.includes('display_name')&&!prop.includes('async_delivery_policy')) check(`target exists:${m.normalized_target}`,src[root].includes(prop));}
console.log(JSON.stringify({status:'PASS',passed,total:passed,checks}));
