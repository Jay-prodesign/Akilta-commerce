import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const file = path.join(root, 'release', 'DESIGN_PARTNER_E5_ADMISSION_TEMPLATE_20260809.json');
const template = JSON.parse(fs.readFileSync(file, 'utf8'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }

const REQUIRED_ENTRY_IDS = ['E5-ENTRY-01','E5-ENTRY-02','E5-ENTRY-03','E5-ENTRY-04','E5-ENTRY-05'];
const REQUIRED_EXIT_IDS = ['E5-EXIT-01','E5-EXIT-02','E5-EXIT-03','E5-EXIT-04','E5-EXIT-05','E5-EXIT-06','E5-EXIT-07','E5-EXIT-08'];
const REQUIRED_E6_SIGNAL_IDS = ['E6-SIGNAL-01','E6-SIGNAL-02','E6-SIGNAL-03','E6-SIGNAL-04'];
const ALLOWED_STATES = new Set(['NOT_RUN','PASS','FAIL','BLOCKED_BY_PROVIDER_ACCESS','BLOCKED_BY_OWNER_ACCESS','BLOCKED_BY_ENVIRONMENT','UNSUPPORTED','NOT_APPLICABLE','SUPERSEDED']);

function structuralErrors(t) {
  const errors = [];
  if (t.target_maturity !== 'E5_DESIGN_PARTNER_PILOT_PASS') errors.push('TARGET_MATURITY_INVALID');
  if (t.release_role !== 'DESIGN_PARTNER') errors.push('RELEASE_ROLE_INVALID');
  if (t.secrets_or_customer_pii_allowed !== false) errors.push('PII_SECRET_POLICY_INVALID');
  const entryIds = new Set((t.entry_gates ?? []).map(x => x.id));
  const exitIds = new Set((t.exit_criteria ?? []).map(x => x.id));
  const signalIds = new Set((t.commercial_review_signals ?? []).map(x => x.id));
  for (const id of REQUIRED_ENTRY_IDS) if (!entryIds.has(id)) errors.push(`ENTRY_MISSING:${id}`);
  for (const id of REQUIRED_EXIT_IDS) if (!exitIds.has(id)) errors.push(`EXIT_MISSING:${id}`);
  for (const id of REQUIRED_E6_SIGNAL_IDS) if (!signalIds.has(id)) errors.push(`SIGNAL_MISSING:${id}`);
  for (const item of [...(t.entry_gates ?? []), ...(t.exit_criteria ?? []), ...(t.commercial_review_signals ?? [])]) {
    if (!ALLOWED_STATES.has(item.state)) errors.push(`STATE_INVALID:${item.id}`);
    if (!Array.isArray(item.evidence_refs)) errors.push(`EVIDENCE_REFS_REQUIRED:${item.id}`);
  }
  if (t.pilot_identity?.threshold_policy !== 'FREEZE_WITH_PILOT_PLAN_NOT_GUESSED') errors.push('THRESHOLD_POLICY_INVALID');
  if (!Array.isArray(t.operational_metrics_to_capture) || !t.operational_metrics_to_capture.includes('support_burden') || !t.operational_metrics_to_capture.includes('cost_per_resolved_conversation')) errors.push('OPERATIONAL_METRICS_INCOMPLETE');
  return errors;
}

function canProjectE5Pass(t) {
  if (structuralErrors(t).length) return false;
  if (t.incident_policy?.open_sev0_or_sev1_blocks_promotion !== true) return false;
  if ((t.incident_policy?.incident_refs ?? []).some(ref => String(ref).startsWith('OPEN_SEV0:') || String(ref).startsWith('OPEN_SEV1:'))) return false;
  if (!t.entry_gates.every(x => x.state === 'PASS' && x.evidence_refs.length > 0)) return false;
  if (!t.exit_criteria.every(x => x.state === 'PASS' && x.evidence_refs.length > 0)) return false;
  const r = t.e5_evidence_record_projection;
  if (!r || r.resultState !== 'PASS' || r.maturity !== 'E5_DESIGN_PARTNER_PILOT_PASS') return false;
  if (!Array.isArray(r.requirementIds) || !r.requirementIds.includes('CRV1-DESIGN-PARTNER-PILOT')) return false;
  if (!Array.isArray(r.evidenceRefs) || r.evidenceRefs.length === 0) return false;
  for (const key of ['providerRef','exactOperationRef','authEvidenceRef','dogfoodRef','designPartnerRef']) if (!r[key]) return false;
  return true;
}

const cases = [];
cases.push(['TEMPLATE-STRUCTURE', () => assert(structuralErrors(template).length === 0, structuralErrors(template).join(','))]);
cases.push(['DEFAULT-NOT-RUN', () => assert(template.overall_state === 'NOT_RUN' && !canProjectE5Pass(template), 'template auto-promoted E5')]);
cases.push(['NO-PII-SECRETS', () => assert(template.secrets_or_customer_pii_allowed === false, 'PII/secrets allowed')]);
cases.push(['ENTRY-SET-COMPLETE', () => assert(REQUIRED_ENTRY_IDS.every(id => template.entry_gates.some(x => x.id === id)), 'entry set incomplete')]);
cases.push(['EXIT-SET-COMPLETE', () => assert(REQUIRED_EXIT_IDS.every(id => template.exit_criteria.some(x => x.id === id)), 'exit set incomplete')]);
cases.push(['COMMERCIAL-SIGNALS-SEPARATE', () => assert(REQUIRED_E6_SIGNAL_IDS.every(id => template.commercial_review_signals.some(x => x.id === id)), 'E6 signals incomplete')]);
cases.push(['THRESHOLD-NOT-GUESSED', () => assert(template.pilot_identity.threshold_policy === 'FREEZE_WITH_PILOT_PLAN_NOT_GUESSED', 'threshold guessed')]);

const missingEntry = clone(template); missingEntry.entry_gates = missingEntry.entry_gates.filter(x => x.id !== 'E5-ENTRY-01');
cases.push(['MISSING-ENTRY-FAILS', () => assert(structuralErrors(missingEntry).some(x => x.startsWith('ENTRY_MISSING')), 'missing entry accepted')]);
const missingExit = clone(template); missingExit.exit_criteria = missingExit.exit_criteria.filter(x => x.id !== 'E5-EXIT-07');
cases.push(['MISSING-OUTCOME-EXIT-FAILS', () => assert(structuralErrors(missingExit).some(x => x.startsWith('EXIT_MISSING')), 'missing outcome accepted')]);
const badState = clone(template); badState.exit_criteria[0].state = 'GREEN';
cases.push(['INVALID-STATE-FAILS', () => assert(structuralErrors(badState).some(x => x.startsWith('STATE_INVALID')), 'invalid state accepted')]);
const fakePass = clone(template); fakePass.e5_evidence_record_projection.resultState = 'PASS';
cases.push(['PROSE-ONLY-PASS-FAILS', () => assert(!canProjectE5Pass(fakePass), 'empty evidence promoted E5')]);

function makePassing() {
  const t = clone(template);
  t.overall_state = 'PASS';
  for (const x of t.entry_gates) { x.state = 'PASS'; x.evidence_refs = [`evidence:${x.id}`]; }
  for (const x of t.exit_criteria) { x.state = 'PASS'; x.evidence_refs = [`evidence:${x.id}`]; }
  const r = t.e5_evidence_record_projection;
  Object.assign(r, {
    resultState: 'PASS',
    evidenceRefs: ['evidence:e5-pilot-bundle'],
    providerRef: 'provider:safe-ref',
    exactOperationRef: 'operation-set:safe-ref',
    authEvidenceRef: 'auth:safe-ref',
    dogfoodRef: 'dogfood:safe-ref',
    designPartnerRef: 'design-partner:safe-ref'
  });
  return t;
}
const passing = makePassing();
cases.push(['FULL-E5-EVIDENCE-CAN-PROJECT', () => assert(canProjectE5Pass(passing), 'complete E5 evidence rejected')]);
for (const field of ['providerRef','exactOperationRef','authEvidenceRef','dogfoodRef','designPartnerRef']) {
  const t = makePassing(); t.e5_evidence_record_projection[field] = null;
  cases.push([`MISSING-${field.toUpperCase()}-FAILS`, () => assert(!canProjectE5Pass(t), `${field} missing but E5 allowed`)]);
}
const openSev = makePassing(); openSev.incident_policy.incident_refs = ['OPEN_SEV1:incident-safe-ref'];
cases.push(['OPEN-SEV1-BLOCKS', () => assert(!canProjectE5Pass(openSev), 'open SEV1 allowed E5')]);
const noEvidence = makePassing(); noEvidence.exit_criteria[3].evidence_refs = [];
cases.push(['EXIT-PASS-REQUIRES-EVIDENCE', () => assert(!canProjectE5Pass(noEvidence), 'exit PASS without evidence allowed')]);
const noCommercial = makePassing();
cases.push(['E6-SIGNALS-NOT-AUTO-PASS', () => assert(noCommercial.commercial_review_signals.every(x => x.state === 'NOT_RUN') && canProjectE5Pass(noCommercial), 'E5 improperly coupled to E6 signals')]);

let pass = 0;
for (const [name, fn] of cases) { fn(); pass += 1; console.log(`PASS ${name}`); }
console.log(`PASS ${pass}/${cases.length} design-partner E5 admission template scenarios`);
