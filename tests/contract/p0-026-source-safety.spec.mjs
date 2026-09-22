import fs from 'node:fs';

const files = [
  '../../packages/events/src/job.ts',
  '../../packages/events/src/outbox.ts',
  '../../packages/events/src/quota-ledger.ts',
  '../../apps/api/src/dispatch-safety.ts',
].map((rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8'));

const forbidden = /\b(access_token|refresh_token|password|secret_value|credential_value|raw_payload|rawPayload)\b/i;

const scenarios = files.map((content, i) => ({
  id: `P0026-SRC-SAFETY-NO-SECRET-OR-RAW-PAYLOAD-FIELD-${i}`,
  actual: !forbidden.test(content),
  expected: true,
}));

// The outbox/job contracts must only ever carry a *Ref, never inline payload content.
scenarios.push({
  id: 'P0026-SRC-SAFETY-OUTBOX-USES-PAYLOAD-REF-ONLY',
  actual: /payloadRef: string/.test(files[1]) && !/payload: string/.test(files[1]),
  expected: true,
});

const failed = scenarios.filter((s) => s.actual !== s.expected);
if (failed.length) {
  for (const f of failed) console.error('FAIL', f);
  throw new Error(`${failed.length}/${scenarios.length} P0-026 source-safety checks failed`);
}
console.log(`PASS ${scenarios.length}/${scenarios.length}`);
for (const s of scenarios) console.log(`PASS ${s.id}`);
