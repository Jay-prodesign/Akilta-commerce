import {
  canEvidenceSupportClaim,
  validateEvidenceRecord,
  type EvidenceRecord,
} from '../../packages/domain/src/evidence-maturity';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const e1: EvidenceRecord = {
  testId: 'FND-001',
  requirementIds: ['REQ-FND-001'],
  capability: 'domain.ids',
  resultState: 'PASS',
  maturity: 'E1_SYNTHETIC_PASS',
  evidenceRefs: ['test:synthetic:1'],
};

const e3: EvidenceRecord = {
  testId: 'M-04',
  requirementIds: ['REQ-FND-010'],
  capability: 'whatsapp.send_message',
  resultState: 'PASS',
  maturity: 'E3_PROVIDER_AUTHENTIC_PASS',
  evidenceRefs: ['provider-run:44'],
  providerRef: 'meta:test-app:1',
  exactOperationRef: 'meta:send-message:v1',
  authEvidenceRef: 'meta:scope-proof:1',
};

const tests: Array<readonly [string, () => void]> = [
  ['E1 supports generic logic', () => assert(canEvidenceSupportClaim(e1, 'GENERIC_LOGIC_WORKS'), 'E1 should support generic logic')],
  ['E1 cannot support provider operation', () => assert(!canEvidenceSupportClaim(e1, 'TARGET_PROVIDER_OPERATION_SUPPORTED'), 'E1 provider escalation')],
  ['E1 cannot support commercial ready', () => assert(!canEvidenceSupportClaim(e1, 'COMMERCIAL_READY'), 'E1 commercial escalation')],
  ['E2 cannot support target provider operation', () => {
    const e2: EvidenceRecord = { ...e1, maturity: 'E2_PROVIDER_REFERENCE_PASS' };
    assert(canEvidenceSupportClaim(e2, 'REFERENCE_SUPPORTS_ABSTRACTION'), 'E2 reference claim missing');
    assert(!canEvidenceSupportClaim(e2, 'TARGET_PROVIDER_OPERATION_SUPPORTED'), 'E2 target-provider escalation');
  }],
  ['valid E3 supports exact provider operation', () => assert(canEvidenceSupportClaim(e3, 'TARGET_PROVIDER_OPERATION_SUPPORTED'), 'E3 provider claim blocked')],
  ['E3 without exact auth evidence is invalid', () => {
    const broken: EvidenceRecord = { ...e3, authEvidenceRef: undefined } as unknown as EvidenceRecord;
    assert(!validateEvidenceRecord(broken).valid, 'missing auth evidence accepted');
  }],
  ['blocked provider test never supports provider claim', () => {
    const blocked: EvidenceRecord = { ...e3, resultState: 'BLOCKED_BY_PROVIDER_ACCESS' };
    assert(!canEvidenceSupportClaim(blocked, 'TARGET_PROVIDER_OPERATION_SUPPORTED'), 'blocked treated as PASS');
  }],
  ['high maturity label with FAIL supports no operational claim', () => {
    const failed: EvidenceRecord = { ...e3, resultState: 'FAIL' };
    assert(!canEvidenceSupportClaim(failed, 'TARGET_PROVIDER_OPERATION_SUPPORTED'), 'FAIL treated as PASS');
  }],
  ['E4 requires dogfood ref', () => {
    const e4 = { ...e3, maturity: 'E4_OWNED_DOGFOOD_PASS' as const };
    assert(!validateEvidenceRecord(e4).valid, 'E4 without dogfood accepted');
  }],
  ['E5 requires design partner ref', () => {
    const e5: EvidenceRecord = { ...e3, maturity: 'E5_DESIGN_PARTNER_PILOT_PASS', dogfoodRef: 'dogfood:1' };
    assert(!validateEvidenceRecord(e5).valid, 'E5 without design partner accepted');
  }],
  ['E6 requires commercial gate refs', () => {
    const e6: EvidenceRecord = { ...e3, maturity: 'E6_COMMERCIAL_READY_PASS', dogfoodRef: 'dogfood:1', designPartnerRef: 'pilot:1' };
    assert(!validateEvidenceRecord(e6).valid, 'E6 without commercial gates accepted');
  }],
  ['complete E6 supports commercial ready', () => {
    const e6: EvidenceRecord = {
      ...e3,
      maturity: 'E6_COMMERCIAL_READY_PASS',
      dogfoodRef: 'dogfood:1',
      designPartnerRef: 'pilot:1',
      commercialGateRefs: ['security:pass', 'privacy:pass', 'ux:pass', 'economics:pass'],
    };
    assert(canEvidenceSupportClaim(e6, 'COMMERCIAL_READY'), 'complete E6 rejected');
  }],
  ['E0 documentation cannot be executable PASS', () => {
    const e0: EvidenceRecord = { ...e1, maturity: 'E0_SPECIFIED', resultState: 'PASS' };
    assert(!validateEvidenceRecord(e0).valid, 'E0 executable PASS accepted');
  }],
];

for (const [name, test] of tests) {
  test();
  console.log(`PASS ${name}`);
}
console.log(`EVIDENCE_MATURITY_PASS ${tests.length}/${tests.length}`);
