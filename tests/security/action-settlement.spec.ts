import { settleActionExecution } from '../../apps/api/src/action-settlement';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function expectThrow(fn: () => unknown, code: string) {
  let thrown = '';
  try { fn(); } catch (error) { thrown = error instanceof Error ? error.message : String(error); }
  assert(thrown === code, `expected ${code}, got ${thrown}`);
}

const cases: Array<{ id: string; run: () => void }> = [
  {
    id: 'SETTLE-01-READ-SUCCESS-NO-POSTREAD',
    run: () => {
      const result = settleActionExecution({ actionName: 'commerce.product.read', evidence: { providerState: 'CONFIRMED_SUCCESS', providerResultRef: 'safe:product-read' } });
      assert(result.status === 'SUCCEEDED' && result.nextSafeAction === 'NONE', 'read should settle success');
    },
  },
  {
    id: 'SETTLE-02-SEND-SUCCESS-REQUIRES-POSTREAD',
    run: () => {
      const result = settleActionExecution({ actionName: 'conversation.reply.send', evidence: { providerState: 'CONFIRMED_SUCCESS', providerResultRef: 'safe:send' } });
      assert(result.status === 'BLOCKED' && result.reason === 'POST_READ_REQUIRED', 'send must wait for post-read');
    },
  },
  {
    id: 'SETTLE-03-SEND-POSTREAD-MATCH-SUCCEEDS',
    run: () => {
      const result = settleActionExecution({ actionName: 'conversation.reply.send', evidence: { providerState: 'CONFIRMED_SUCCESS', providerResultRef: 'safe:send', postReadState: 'VERIFIED_MATCH', postReadEvidenceRef: 'safe:postread' } });
      assert(result.status === 'SUCCEEDED', 'verified send should succeed');
    },
  },
  {
    id: 'SETTLE-04-REVERSIBLE-MISMATCH-COMPENSATES',
    run: () => {
      const result = settleActionExecution({ actionName: 'merchant_rule.activate', evidence: { providerState: 'CONFIRMED_SUCCESS', providerResultRef: 'safe:rule', postReadState: 'VERIFIED_MISMATCH', postReadEvidenceRef: 'safe:mismatch' } });
      assert(result.status === 'COMPENSATION_REQUIRED' && result.nextSafeAction === 'COMPENSATE_OR_ROLLBACK', 'reversible mismatch should require compensation');
    },
  },
  {
    id: 'SETTLE-05-IRREVERSIBLE-MISMATCH-BLOCKS',
    run: () => {
      const result = settleActionExecution({ actionName: 'conversation.reply.send', evidence: { providerState: 'CONFIRMED_SUCCESS', providerResultRef: 'safe:send', postReadState: 'VERIFIED_MISMATCH', postReadEvidenceRef: 'safe:mismatch' } });
      assert(result.status === 'BLOCKED' && result.nextSafeAction === 'MANUAL_REVIEW', 'irreversible mismatch must not pretend rollback');
    },
  },
  {
    id: 'SETTLE-06-UNKNOWN-OUTCOME-RECONCILES',
    run: () => {
      const result = settleActionExecution({ actionName: 'conversation.reply.send', evidence: { providerState: 'OUTCOME_UNKNOWN' } });
      assert(result.status === 'BLOCKED' && result.nextSafeAction === 'RECONCILE_PROVIDER_RESULT', 'unknown outcome must reconcile before retry');
    },
  },
  {
    id: 'SETTLE-07-REVERSIBLE-PARTIAL-REQUIRES-COMPENSATION',
    run: () => {
      const result = settleActionExecution({ actionName: 'merchant_rule.activate', evidence: { providerState: 'PARTIAL_EFFECT', providerResultRef: 'safe:partial' } });
      assert(result.status === 'COMPENSATION_REQUIRED', 'reversible partial effect should compensate');
    },
  },
  {
    id: 'SETTLE-08-IRREVERSIBLE-PARTIAL-BLOCKS',
    run: () => {
      const result = settleActionExecution({ actionName: 'conversation.reply.send', evidence: { providerState: 'PARTIAL_EFFECT', providerResultRef: 'safe:partial' } });
      assert(result.status === 'BLOCKED' && result.nextSafeAction === 'MANUAL_REVIEW', 'irreversible partial effect needs manual review');
    },
  },
  {
    id: 'SETTLE-09-CONFIRMED-FAILURE-FAILS',
    run: () => {
      const result = settleActionExecution({ actionName: 'conversation.reply.send', evidence: { providerState: 'CONFIRMED_FAILURE', providerResultRef: 'safe:failed-send' } });
      assert(result.status === 'FAILED', 'confirmed failure should fail');
    },
  },
  {
    id: 'SETTLE-10-POSTREAD-UNAVAILABLE-BLOCKS',
    run: () => {
      const result = settleActionExecution({ actionName: 'merchant_rule.activate', evidence: { providerState: 'CONFIRMED_SUCCESS', providerResultRef: 'safe:rule', postReadState: 'UNAVAILABLE' } });
      assert(result.status === 'BLOCKED' && result.reason === 'POST_READ_UNAVAILABLE', 'unavailable post-read cannot be success');
    },
  },
  {
    id: 'SETTLE-11-MISSING-PROVIDER-EVIDENCE-REFUSED',
    run: () => expectThrow(() => settleActionExecution({ actionName: 'merchant_rule.activate', evidence: { providerState: 'CONFIRMED_SUCCESS' } }), 'PROVIDER_RESULT_EVIDENCE_REQUIRED'),
  },
  {
    id: 'SETTLE-12-MISSING-POSTREAD-EVIDENCE-REFUSED',
    run: () => expectThrow(() => settleActionExecution({ actionName: 'merchant_rule.activate', evidence: { providerState: 'CONFIRMED_SUCCESS', providerResultRef: 'safe:rule', postReadState: 'VERIFIED_MATCH' } }), 'POST_READ_EVIDENCE_REQUIRED'),
  },
  {
    id: 'SETTLE-13-UNREGISTERED-ACTION-REFUSED',
    run: () => expectThrow(() => settleActionExecution({ actionName: 'provider.raw.mutate', evidence: { providerState: 'OUTCOME_UNKNOWN' } }), 'UNREGISTERED_ACTION'),
  },
  {
    id: 'SETTLE-14-MISMATCH-USES-CANONICAL-ERROR',
    run: () => {
      const result = settleActionExecution({ actionName: 'merchant_rule.activate', evidence: { providerState: 'CONFIRMED_SUCCESS', providerResultRef: 'safe:rule', postReadState: 'VERIFIED_MISMATCH', postReadEvidenceRef: 'safe:mismatch' } });
      assert(result.errorCode === 'ACTION_POSTREAD_MISMATCH', 'canonical mismatch code required');
    },
  },
];

for (const testCase of cases) {
  testCase.run();
  console.log(`PASS ${testCase.id}`);
}
console.log(`PASS ${cases.length}/${cases.length} action settlement scenarios`);
