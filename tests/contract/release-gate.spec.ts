import {
  evaluateReleaseGate,
  incidentRequiresImmediateStop,
  INCIDENT_STOP_CONDITIONS,
  type ReleaseGateInput,
  type ReleaseEvidenceRequirement,
} from '../../packages/domain/src/release-gate';
import type { EvidenceRecord } from '../../packages/domain/src/evidence-maturity';

function record(
  testId: string,
  requirementId: string,
  capability: string,
  maturity: EvidenceRecord['maturity'],
  resultState: EvidenceRecord['resultState'] = 'PASS',
  extra: Partial<EvidenceRecord> = {},
): EvidenceRecord {
  return {
    testId,
    requirementIds: [requirementId],
    capability,
    resultState,
    maturity,
    evidenceRefs: resultState === 'PASS' && maturity !== 'E0_SPECIFIED' ? [`evidence:${testId}`] : [],
    ...extra,
  };
}

function req(
  requirementId: string,
  role: ReleaseEvidenceRequirement['role'],
  requiredMaturity: EvidenceRecord['maturity'],
  evidenceRecord: EvidenceRecord,
): ReleaseEvidenceRequirement {
  return { requirementId, role, requiredMaturity, record: evidenceRecord };
}

const baseEvidence = req('FND-A', 'BASE', 'E1_SYNTHETIC_PASS', record('fnd-a', 'FND-A', 'grounded-core', 'E1_SYNTHETIC_PASS'));
const base: ReleaseGateInput = {
  target: 'GROUNDED_MESSAGING_CORE',
  evidence: [baseEvidence],
  openDefects: [],
  openIncidents: [],
  providerClaimRequired: false,
};

const provider = req(
  'M-05',
  'PROVIDER_AUTHENTIC',
  'E3_PROVIDER_AUTHENTIC_PASS',
  record('m05', 'M-05', 'whatsapp.send_message', 'E3_PROVIDER_AUTHENTIC_PASS', 'PASS', {
    providerRef: 'provider-readback:m05',
    exactOperationRef: 'operation:m05',
    authEvidenceRef: 'auth:m05',
  }),
);
const runtime = req(
  'REL-RUNTIME',
  'RUNTIME_RELIABILITY',
  'E3_PROVIDER_AUTHENTIC_PASS',
  record('runtime', 'REL-RUNTIME', 'runtime.reliability', 'E3_PROVIDER_AUTHENTIC_PASS', 'PASS', {
    providerRef: 'runtime:provider', exactOperationRef: 'runtime:operation', authEvidenceRef: 'runtime:auth',
  }),
);
const recovery = req(
  'REL-RECOVERY',
  'RECOVERY',
  'E3_PROVIDER_AUTHENTIC_PASS',
  record('recovery', 'REL-RECOVERY', 'recovery.restore', 'E3_PROVIDER_AUTHENTIC_PASS', 'PASS', {
    providerRef: 'recovery:provider', exactOperationRef: 'recovery:operation', authEvidenceRef: 'recovery:auth',
  }),
);
const designPartner = req(
  'PILOT-E5',
  'DESIGN_PARTNER',
  'E5_DESIGN_PARTNER_PILOT_PASS',
  record('pilot', 'PILOT-E5', 'design-partner.pilot', 'E5_DESIGN_PARTNER_PILOT_PASS', 'PASS', {
    providerRef: 'pilot:provider', exactOperationRef: 'pilot:operation', authEvidenceRef: 'pilot:auth',
    dogfoodRef: 'dogfood:1', designPartnerRef: 'pilot:1',
  }),
);

let passed = 0;
function assertEqual(actual: unknown, expected: unknown) { if (actual !== expected) throw new Error(`ASSERT_EQUAL_FAILED:${String(actual)}!=${String(expected)}`); }
function t(name: string, fn: () => void) { fn(); passed += 1; console.log(`PASS ${name}`); }

t('synthetic grounded core may pass without provider claim', () => {
  assertEqual(evaluateReleaseGate(base).decision, 'PASS');
});

t('blocked evidence never passes', () => {
  const blocked = req('FND-A', 'BASE', 'E1_SYNTHETIC_PASS', record('fnd-a-blocked', 'FND-A', 'grounded-core', 'E1_SYNTHETIC_PASS', 'BLOCKED_BY_PROVIDER_ACCESS'));
  assertEqual(evaluateReleaseGate({ ...base, evidence: [blocked] }).decision, 'BLOCKED');
});

t('low maturity blocks required higher maturity', () => {
  assertEqual(evaluateReleaseGate({ ...base, evidence: [{ ...baseEvidence, requiredMaturity: 'E3_PROVIDER_AUTHENTIC_PASS' }] }).decision, 'BLOCKED');
});

t('invalid E3 record cannot satisfy provider claim', () => {
  const invalidProvider = req('M-05', 'PROVIDER_AUTHENTIC', 'E3_PROVIDER_AUTHENTIC_PASS', record('bad-m05', 'M-05', 'whatsapp.send_message', 'E3_PROVIDER_AUTHENTIC_PASS'));
  assertEqual(evaluateReleaseGate({ ...base, providerClaimRequired: true, evidence: [baseEvidence, invalidProvider] }).decision, 'BLOCKED');
});

t('provider claim requires typed valid E3 evidence', () => {
  assertEqual(evaluateReleaseGate({ ...base, providerClaimRequired: true, evidence: [baseEvidence, provider] }).decision, 'PASS');
});

t('requirement binding cannot be bypassed', () => {
  const mismatch = { ...provider, requirementId: 'M-04' };
  assertEqual(evaluateReleaseGate({ ...base, providerClaimRequired: true, evidence: [baseEvidence, mismatch] }).decision, 'BLOCKED');
});

t('critical defect blocks', () => {
  assertEqual(evaluateReleaseGate({ ...base, openDefects: [{ defectId: 'D1', severity: 'CRITICAL', category: 'SECURITY' }] }).decision, 'BLOCKED');
});

t('high defect blocks', () => {
  assertEqual(evaluateReleaseGate({ ...base, openDefects: [{ defectId: 'D2', severity: 'HIGH', category: 'TRUTH' }] }).decision, 'BLOCKED');
});

t('SEV0 incident blocks', () => {
  assertEqual(evaluateReleaseGate({ ...base, openIncidents: [{ incidentId: 'I1', severity: 'SEV0' }] }).decision, 'BLOCKED');
});

t('support launch cannot pass with booleans because booleans no longer exist', () => {
  assertEqual(evaluateReleaseGate({ ...base, target: 'SUPPORT_LAUNCH' }).decision, 'BLOCKED');
});

t('support launch passes only with typed runtime and recovery evidence', () => {
  assertEqual(evaluateReleaseGate({ ...base, target: 'SUPPORT_LAUNCH', evidence: [baseEvidence, runtime, recovery] }).decision, 'PASS');
});

t('commercial ready requires design partner and commercial review', () => {
  assertEqual(evaluateReleaseGate({ ...base, target: 'COMMERCIAL_READY', evidence: [baseEvidence, runtime, recovery] }).decision, 'BLOCKED');
});

t('commercial ready passes only after typed E5 pilot plus represented gates', () => {
  assertEqual(evaluateReleaseGate({ ...base, target: 'COMMERCIAL_READY', evidence: [baseEvidence, runtime, recovery, designPartner], commercialReviewRef: 'review-1' }).decision, 'PASS');
});

t('all canonical stop conditions demand immediate stop', () => {
  assertEqual(INCIDENT_STOP_CONDITIONS.every((x) => incidentRequiresImmediateStop(x)), true);
});

console.log(`RELEASE_GATE_PASS ${passed}/14`);
