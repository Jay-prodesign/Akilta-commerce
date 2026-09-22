import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.env.AI_COMMERCE_STAGING_ROOT ?? process.cwd();
const shopifyPath = path.join(root, 'connectors/shopify/src/index.ts');
const source = fs.readFileSync(shopifyPath, 'utf8');

assert.match(source, /provider: 'shopify'/);
assert.match(source, /apiVersionState: 'EVIDENCE_REQUIRED'/);
assert.doesNotMatch(source, /supportState: 'AVAILABLE'/);
assert.match(source, /supportState: 'BLOCKED_BY_ACCESS'/);
assert.match(source, /operationId: 'get_fulfillment',\s*\n\s*supportState: 'UNKNOWN'/);
assert.match(source, /operationId: 'get_tracking',\s*\n\s*supportState: 'UNKNOWN'/);
assert.match(source, /operationId: 'verify_customer_order_access'/);
assert.doesNotMatch(source, /https?:\/\//);
assert.doesNotMatch(source, /client_secret|access_token|api[_-]?key/i);

// D-099 reference-connector distinction: not a Phase 1B post-reference label.
assert.doesNotMatch(source, /connectorVersion: 'phase1b/);
assert.match(source, /connectorVersion: 'v1-reference-staging-e2-evidence-gated'/);

// Real, schema-introspection-verified E2 facts must be cited, not guessed.
assert.match(source, /last 60 days/i);
assert.match(source, /read_all_orders/);
assert.match(source, /quantities\(names:\[\.\.\.\]\)/);

console.log('shopify reference connector staging: 10/10 PASS');
