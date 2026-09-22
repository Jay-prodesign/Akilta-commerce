import fs from 'node:fs';
import path from 'node:path';
const t = JSON.parse(fs.readFileSync(path.join(process.cwd(),'release','OWNED_DOGFOOD_E4_ADMISSION_TEMPLATE_20260809.json'),'utf8'));
function assert(x,m){if(!x)throw new Error(m)}
function clone(x){return JSON.parse(JSON.stringify(x))}
const ENTRY=['E4-ENTRY-01','E4-ENTRY-02','E4-ENTRY-03','E4-ENTRY-04','E4-ENTRY-05'];
const EXIT=['E4-EXIT-01','E4-EXIT-02','E4-EXIT-03','E4-EXIT-04','E4-EXIT-05','E4-EXIT-06'];
const STATES=new Set(['NOT_RUN','PASS','FAIL','BLOCKED_BY_PROVIDER_ACCESS','BLOCKED_BY_OWNER_ACCESS','BLOCKED_BY_ENVIRONMENT','UNSUPPORTED','NOT_APPLICABLE','SUPERSEDED']);
function errors(x){
 const e=[];
 if(x.target_maturity!=='E4_OWNED_DOGFOOD_PASS')e.push('MATURITY');
 if(x.secrets_or_customer_pii_allowed!==false)e.push('SECRET_POLICY');
 for(const id of ENTRY)if(!x.entry_gates?.some(y=>y.id===id))e.push('ENTRY:'+id);
 for(const id of EXIT)if(!x.exit_criteria?.some(y=>y.id===id))e.push('EXIT:'+id);
 for(const y of [...(x.entry_gates??[]),...(x.exit_criteria??[])]){if(!STATES.has(y.state))e.push('STATE:'+y.id);if(!Array.isArray(y.evidence_refs))e.push('REFS:'+y.id)}
 if(x.dogfood_identity?.threshold_policy!=='FREEZE_WITH_DOGFOOD_PLAN_NOT_GUESSED')e.push('THRESHOLD');
 for(const k of ['retry_and_duplicate_behavior','handoff_and_human_takeover','merchant_correction_and_rule_evaluation','usage_and_cost','operator_support_burden'])if(!x.operational_evidence_to_capture?.includes(k))e.push('OP:'+k);
 return e;
}
function canE4(x){
 if(errors(x).length)return false;
 if((x.incident_policy?.incident_refs??[]).some(r=>String(r).startsWith('OPEN_SEV0:')||String(r).startsWith('OPEN_SEV1:')))return false;
 if(!x.entry_gates.every(y=>y.state==='PASS'&&y.evidence_refs.length))return false;
 if(!x.exit_criteria.every(y=>y.state==='PASS'&&y.evidence_refs.length))return false;
 const r=x.e4_evidence_record_projection;
 if(!r||r.resultState!=='PASS'||r.maturity!=='E4_OWNED_DOGFOOD_PASS'||!r.requirementIds?.includes('CRV1-OWNED-DOGFOOD')||!r.evidenceRefs?.length)return false;
 for(const k of ['providerRef','exactOperationRef','authEvidenceRef','dogfoodRef'])if(!r[k])return false;
 return true;
}
function passing(){const x=clone(t);x.overall_state='PASS';for(const y of x.entry_gates){y.state='PASS';y.evidence_refs=[`evidence:${y.id}`]}for(const y of x.exit_criteria){y.state='PASS';y.evidence_refs=[`evidence:${y.id}`]}Object.assign(x.e4_evidence_record_projection,{resultState:'PASS',evidenceRefs:['evidence:e4-bundle'],providerRef:'provider:safe',exactOperationRef:'ops:safe',authEvidenceRef:'auth:safe',dogfoodRef:'dogfood:safe'});return x}
const cases=[];
cases.push(['STRUCTURE',()=>assert(!errors(t).length,errors(t).join(','))]);
cases.push(['DEFAULT-NOT-RUN',()=>assert(t.overall_state==='NOT_RUN'&&!canE4(t),'auto pass')]);
cases.push(['NO-PII-SECRETS',()=>assert(t.secrets_or_customer_pii_allowed===false,'secret policy')]);
cases.push(['ENTRY-COMPLETE',()=>assert(ENTRY.every(id=>t.entry_gates.some(x=>x.id===id)),'entry')]);
cases.push(['EXIT-COMPLETE',()=>assert(EXIT.every(id=>t.exit_criteria.some(x=>x.id===id)),'exit')]);
cases.push(['THRESHOLD-NOT-GUESSED',()=>assert(t.dogfood_identity.threshold_policy==='FREEZE_WITH_DOGFOOD_PLAN_NOT_GUESSED','threshold')]);
const me=clone(t);me.entry_gates=me.entry_gates.filter(x=>x.id!=='E4-ENTRY-03');cases.push(['MISSING-RUNTIME-ENTRY-FAILS',()=>assert(errors(me).some(x=>x.startsWith('ENTRY:')),'missing entry')]);
const mx=clone(t);mx.exit_criteria=mx.exit_criteria.filter(x=>x.id!=='E4-EXIT-05');cases.push(['MISSING-OPERATOR-EXIT-FAILS',()=>assert(errors(mx).some(x=>x.startsWith('EXIT:')),'missing exit')]);
const bs=clone(t);bs.exit_criteria[0].state='GREEN';cases.push(['INVALID-STATE-FAILS',()=>assert(errors(bs).some(x=>x.startsWith('STATE:')),'bad state')]);
const prose=clone(t);prose.e4_evidence_record_projection.resultState='PASS';cases.push(['PROSE-ONLY-PASS-FAILS',()=>assert(!canE4(prose),'prose pass')]);
const p=passing();cases.push(['FULL-E4-CAN-PROJECT',()=>assert(canE4(p),'full evidence rejected')]);
for(const k of ['providerRef','exactOperationRef','authEvidenceRef','dogfoodRef']){const x=passing();x.e4_evidence_record_projection[k]=null;cases.push([`MISSING-${k.toUpperCase()}-FAILS`,()=>assert(!canE4(x),k)])}
const sev=passing();sev.incident_policy.incident_refs=['OPEN_SEV0:incident-safe'];cases.push(['OPEN-SEV0-BLOCKS',()=>assert(!canE4(sev),'sev0')]);
const nr=passing();nr.exit_criteria[0].evidence_refs=[];cases.push(['EXIT-PASS-REQUIRES-EVIDENCE',()=>assert(!canE4(nr),'no refs')]);
cases.push(['E4-DOES-NOT-IMPLY-E5-E6',()=>assert(t.promotion_rules.e4_pass_does_not_imply_e5_or_e6===true,'maturity leak')]);
let n=0;for(const [name,fn] of cases){fn();n++;console.log('PASS '+name)}console.log(`PASS ${n}/${cases.length} owned-dogfood E4 admission template scenarios`);
