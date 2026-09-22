import { approvalClientCommand, selectApprovalSurface } from '../../apps/control-center/src/approval-state';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function expectThrow(fn: () => unknown, message: string) { let ok=false; try{fn();}catch{ok=true;} assert(ok,message); }

const cases: Array<[string, () => void]> = [
  ['R1-APPROVAL-SURFACE-NOT-APPLICABLE', () => {
    const r=selectApprovalSurface({riskClass:'R1',requestedSurface:'WEB_CONTROL_CENTER',assuranceLevel:'STRONG'});
    assert(r.decision==='DENY_SURFACE' && r.reason==='APPROVAL_NOT_APPLICABLE','R1 approval surface opened');
  }],
  ['R3-WEB-STANDARD-ALLOWED', () => {
    const r=selectApprovalSurface({riskClass:'R3',requestedSurface:'WEB_CONTROL_CENTER',assuranceLevel:'STANDARD'});
    assert(r.decision==='ALLOW_SURFACE' && r.surface==='WEB_CONTROL_CENTER','R3 web approval denied');
  }],
  ['R3-WHATSAPP-STANDARD-DENIED', () => {
    const r=selectApprovalSurface({riskClass:'R3',requestedSurface:'MERCHANT_WHATSAPP',assuranceLevel:'STANDARD'});
    assert(r.decision==='DENY_SURFACE' && r.reason==='ASSURANCE_INSUFFICIENT','R3 low-assurance WhatsApp approval allowed');
  }],
  ['R3-WHATSAPP-STEPUP-ALLOWED', () => {
    const r=selectApprovalSurface({riskClass:'R3',requestedSurface:'MERCHANT_WHATSAPP',assuranceLevel:'STEP_UP'});
    assert(r.decision==='ALLOW_SURFACE' && r.surface==='MERCHANT_WHATSAPP' && r.requiresStepUp,'R3 stepped-up WhatsApp approval denied');
  }],
  ['R4-WHATSAPP-STRONG-STILL-WEB-REQUIRED', () => {
    const r=selectApprovalSurface({riskClass:'R4',requestedSurface:'MERCHANT_WHATSAPP',assuranceLevel:'STRONG'});
    assert(r.decision==='DENY_SURFACE' && r.reason==='WEB_STEP_UP_REQUIRED','R4 WhatsApp approval allowed');
  }],
  ['R4-WEB-STANDARD-STEPUP-REQUIRED', () => {
    const r=selectApprovalSurface({riskClass:'R4',requestedSurface:'WEB_CONTROL_CENTER',assuranceLevel:'STANDARD'});
    assert(r.decision==='DENY_SURFACE' && r.reason==='WEB_STEP_UP_REQUIRED','R4 standard web approval allowed');
  }],
  ['R4-WEB-STEPUP-ALLOWED', () => {
    const r=selectApprovalSurface({riskClass:'R4',requestedSurface:'WEB_CONTROL_CENTER',assuranceLevel:'STEP_UP'});
    assert(r.decision==='ALLOW_SURFACE' && r.requiresStepUp,'R4 stepped-up web approval denied');
  }],
  ['R5-WEB-STRONG-ALLOWED-ONLY-SURFACE', () => {
    const r=selectApprovalSurface({riskClass:'R5',requestedSurface:'WEB_CONTROL_CENTER',assuranceLevel:'STRONG'});
    assert(r.decision==='ALLOW_SURFACE' && r.surface==='WEB_CONTROL_CENTER','R5 web strong denied');
  }],
  ['CLIENT-COMMAND-OPAQUE-REF-ONLY', () => {
    const command=approvalClientCommand({approvalRequestId:'apr_001',opaqueActionRef:'opaque_server_ref',decision:'APPROVE'});
    assert(Object.keys(command).sort().join(',')==='approvalRequestId,decision,opaqueActionRef','approval command carries extra authority payload');
  }],
  ['CLIENT-COMMAND-REQUIRES-OPAQUE-REF', () => expectThrow(() => approvalClientCommand({approvalRequestId:'apr_001',opaqueActionRef:'',decision:'APPROVE'}),'empty opaque ref accepted')],
];
for (const [name,fn] of cases){fn();console.log(`PASS ${name}`);} console.log(`PASS ${cases.length}/${cases.length} approval surface scenarios`);
