import fs from 'node:fs';

const sql = fs.readFileSync(new URL('../../migrations/0001_foundation.sql', import.meta.url), 'utf8');
const affectedTables = ['products','variants','inventory_observations','fulfillments','shipments','operational_events'];

function tableBlock(name) {
  const match = sql.match(new RegExp(`CREATE TABLE ${name} \\(([\\s\\S]*?)\\n\\);`));
  if (!match) throw new Error(`Missing table ${name}`);
  return match[1];
}

const scenarios = [];
for (const table of affectedTables) {
  const block = tableBlock(table);
  scenarios.push({
    id: `SOURCE-TIME-${table.toUpperCase()}-NULLABLE`,
    actual: /source_timestamp TIMESTAMPTZ(?:,|\n)/.test(block) && !/source_timestamp TIMESTAMPTZ NOT NULL/.test(block),
    expected: true,
  });
  scenarios.push({
    id: `OBSERVED-AT-${table.toUpperCase()}-REQUIRED`,
    actual: /observed_at TIMESTAMPTZ NOT NULL/.test(block),
    expected: true,
  });
}
const failed = scenarios.filter((s) => s.actual !== s.expected);
if (failed.length) {
  for (const item of failed) console.error('FAIL', item);
  throw new Error(`${failed.length}/${scenarios.length} source-time schema checks failed`);
}
console.log(`SOURCE_TIMESTAMP_SCHEMA ${scenarios.length}/${scenarios.length} PASS`);
