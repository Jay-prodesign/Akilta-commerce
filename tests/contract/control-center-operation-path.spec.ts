import { buildOperationPath } from '../../apps/control-center/src/operation-path';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function main(): void {
  assert(
    buildOperationPath('usage.summary') === '/v1/usage/summary',
    'An operation with no path params resolves to its exact literal path',
  );

  assert(
    buildOperationPath('integration.list') === '/v1/integrations',
    'Another no-param operation resolves exactly',
  );

  assert(
    buildOperationPath('conversation.get', { id: 'conv_123' }) === '/v1/conversations/conv_123',
    'A single {id} placeholder is substituted from pathParams.id',
  );

  assert(
    buildOperationPath('workspace.readiness', { workspace: 'mw_abc' }) === '/v1/workspaces/mw_abc/readiness',
    'A non-"id" placeholder name is substituted by its own name',
  );

  assert(
    buildOperationPath('rule.activate', { id: 'rule_1', version: 'v2' }) === '/v1/rules/rule_1/versions/v2/activate',
    'Multiple distinct placeholders in one path are all substituted',
  );

  assert(
    buildOperationPath('conversation.get') === null,
    'A required placeholder with no supplied value fails closed to null, never a partial path',
  );

  assert(
    buildOperationPath('conversation.get', { id: '' }) === null,
    'An empty-string param value is rejected, not substituted as ""',
  );

  assert(
    buildOperationPath('not_a_real_operation') === null,
    'An unknown operation key fails closed to null rather than guessing a path',
  );

  assert(
    buildOperationPath('conversation.get', { id: 'has spaces & stuff' }) === '/v1/conversations/has%20spaces%20%26%20stuff',
    'Path param values are percent-encoded, never interpolated raw into the URL path',
  );

  console.log('control-center-operation-path: 9/9 PASS');
}

main();
