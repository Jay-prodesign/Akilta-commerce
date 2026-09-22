import {
  validateActionInputAgainstSchema,
  validateRegisteredActionInput,
  type ActionInputSchema,
} from '../../packages/authz/src/action-input-schema';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// Test-only structural schema. It intentionally does not freeze the production payload fields for
// conversation.reply.send; production schemas remain a separate server/tool-registry artifact.
const schema: ActionInputSchema = {
  actionName: 'conversation.reply.send',
  schemaVersion: '1',
  fields: {
    opaqueResourceRef: { type: 'string', required: true, minLength: 1, maxLength: 120 },
    opaquePayloadRef: { type: 'string', required: true, minLength: 1, maxLength: 120 },
    attempt: { type: 'integer' },
    tags: { type: 'string_array', maxLength: 4 },
  },
};

const valid = {
  opaqueResourceRef: 'conversation:001',
  opaquePayloadRef: 'payload:001',
  attempt: 1,
  tags: ['support'],
};

const cases: Array<[string, () => void]> = [
  ['REGISTERED-MATCHING-SCHEMA-PASS', () => {
    const result = validateRegisteredActionInput({ actionName: 'conversation.reply.send', schemaVersion: '1', payload: valid, schema });
    assert(result.decision === 'PASS', 'matching registered action input did not pass');
  }],
  ['UNREGISTERED-ACTION-DENY', () => {
    const result = validateRegisteredActionInput({ actionName: 'arbitrary.http', schemaVersion: '1', payload: valid, schema: { ...schema, actionName: 'arbitrary.http' } });
    assert(result.decision === 'DENY' && result.reason === 'UNREGISTERED_ACTION', 'unregistered action accepted');
  }],
  ['ACTION-SCHEMA-VERSION-MISMATCH-DENY', () => {
    const result = validateRegisteredActionInput({ actionName: 'conversation.reply.send', schemaVersion: '999', payload: valid, schema: { ...schema, schemaVersion: '999' } });
    assert(result.decision === 'DENY' && result.reason === 'ACTION_SCHEMA_VERSION_MISMATCH', 'stale action schema accepted');
  }],
  ['SCHEMA-ACTION-MISMATCH-DENY', () => {
    const result = validateRegisteredActionInput({ actionName: 'conversation.reply.send', schemaVersion: '1', payload: valid, schema: { ...schema, actionName: 'commerce.product.read' } });
    assert(result.decision === 'DENY' && result.reason === 'SCHEMA_ACTION_MISMATCH', 'wrong action schema accepted');
  }],
  ['SCHEMA-VERSION-MISMATCH-DENY', () => {
    const result = validateRegisteredActionInput({ actionName: 'conversation.reply.send', schemaVersion: '1', payload: valid, schema: { ...schema, schemaVersion: '2' } });
    assert(result.decision === 'DENY' && result.reason === 'SCHEMA_VERSION_MISMATCH', 'wrong schema version accepted');
  }],
  ['NON-OBJECT-DENY', () => {
    const result = validateActionInputAgainstSchema({ payload: 'payload:001', schema });
    assert(result.decision === 'DENY' && result.reason === 'PAYLOAD_NOT_OBJECT', 'non-object payload accepted');
  }],
  ['UNKNOWN-FIELD-DENY', () => {
    const result = validateActionInputAgainstSchema({ payload: { ...valid, extra: true }, schema });
    assert(result.decision === 'DENY' && result.reason === 'UNKNOWN_FIELD', 'unknown field accepted');
  }],
  ['REQUIRED-FIELD-DENY', () => {
    const { opaquePayloadRef: _omitted, ...payload } = valid;
    const result = validateActionInputAgainstSchema({ payload, schema });
    assert(result.decision === 'DENY' && result.reason === 'REQUIRED_FIELD_MISSING', 'missing required field accepted');
  }],
  ['WRONG-TYPE-DENY', () => {
    const result = validateActionInputAgainstSchema({ payload: { ...valid, attempt: '1' }, schema });
    assert(result.decision === 'DENY' && result.reason === 'FIELD_TYPE_INVALID', 'wrong type accepted');
  }],
  ['NON-INTEGER-DENY', () => {
    const result = validateActionInputAgainstSchema({ payload: { ...valid, attempt: 1.5 }, schema });
    assert(result.decision === 'DENY' && result.reason === 'FIELD_TYPE_INVALID', 'non-integer accepted');
  }],
  ['STRING-ARRAY-MIXED-DENY', () => {
    const result = validateActionInputAgainstSchema({ payload: { ...valid, tags: ['ok', 2] }, schema });
    assert(result.decision === 'DENY' && result.reason === 'FIELD_TYPE_INVALID', 'mixed array accepted');
  }],
  ['TOP-LEVEL-AUTHORITY-FIELD-DENY', () => {
    const result = validateActionInputAgainstSchema({ payload: { ...valid, permissions: ['admin'] }, schema });
    assert(result.decision === 'DENY' && result.reason === 'AUTHORITY_FIELD_FORBIDDEN', 'authority field accepted');
  }],
  ['SNAKE-CASE-AUTHORITY-FIELD-DENY', () => {
    const result = validateActionInputAgainstSchema({ payload: { ...valid, merchant_workspace_id: 'other' }, schema });
    assert(result.decision === 'DENY' && result.reason === 'AUTHORITY_FIELD_FORBIDDEN', 'snake-case authority field accepted');
  }],
  ['NESTED-AUTHORITY-FIELD-DENY', () => {
    const result = validateActionInputAgainstSchema({ payload: { ...valid, opaquePayloadRef: { nested: { accessToken: 'secret' } } }, schema });
    assert(result.decision === 'DENY' && result.reason === 'AUTHORITY_FIELD_FORBIDDEN', 'nested authority field accepted');
  }],
  ['FIELD-LENGTH-DENY', () => {
    const result = validateActionInputAgainstSchema({ payload: { ...valid, opaquePayloadRef: 'x'.repeat(121) }, schema });
    assert(result.decision === 'DENY' && result.reason === 'FIELD_LENGTH_INVALID', 'oversized field accepted');
  }],
  ['ARRAY-LENGTH-DENY', () => {
    const result = validateActionInputAgainstSchema({ payload: { ...valid, tags: ['a','b','c','d','e'] }, schema });
    assert(result.decision === 'DENY' && result.reason === 'FIELD_LENGTH_INVALID', 'oversized array accepted');
  }],
];

for (const [name, run] of cases) {
  run();
  console.log(`PASS ${name}`);
}
console.log(`PASS ${cases.length}/${cases.length} action input schema scenarios`);
