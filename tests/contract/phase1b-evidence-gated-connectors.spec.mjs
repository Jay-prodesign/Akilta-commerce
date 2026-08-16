import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.env.AI_COMMERCE_STAGING_ROOT ?? process.cwd();
const ikasPath = path.join(root, 'connectors/ikas/src/index.ts');
const tsoftPath = path.join(root, 'connectors/tsoft/src/index.ts');

for (const [provider, filePath] of [['ikas', ikasPath], ['tsoft', tsoftPath]]) {
  const source = fs.readFileSync(filePath, 'utf8');
  assert.match(source, new RegExp(`provider: '${provider}'`));
  assert.match(source, /apiVersionState: 'EVIDENCE_REQUIRED'/);
  assert.doesNotMatch(source, /supportState: 'AVAILABLE'/);
  assert.match(source, /supportState: 'BLOCKED_BY_ACCESS'/);
  assert.match(source, /operationId: 'get_fulfillment', supportState: 'UNKNOWN'/);
  assert.match(source, /operationId: 'get_tracking', supportState: 'UNKNOWN'/);
  assert.doesNotMatch(source, /https?:\/\//);
  assert.doesNotMatch(source, /client_secret|access_token|api[_-]?key/i);
}

const ikas = fs.readFileSync(ikasPath, 'utf8');
assert.match(ikas, /exact signature algorithm/i);
assert.match(ikas, /runtime endpoint\/account environment/i);

const tsoft = fs.readFileSync(tsoftPath, 'utf8');
assert.match(tsoft, /negative-stock/i);
assert.match(tsoft, /raw quantity must not be treated as portable sellability/i);

console.log('phase1b evidence-gated connector staging: 12/12 PASS');
