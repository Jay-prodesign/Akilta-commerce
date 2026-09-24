import { getActionDefinition } from './action-registry';

export const ACTION_INPUT_VALUE_TYPES = [
  'string',
  'boolean',
  'number',
  'integer',
  'string_array',
] as const;
export type ActionInputValueType = (typeof ACTION_INPUT_VALUE_TYPES)[number];

export interface ActionInputFieldSpec {
  readonly type: ActionInputValueType;
  readonly required?: boolean;
  readonly minLength?: number;
  readonly maxLength?: number;
}

/**
 * Provider-independent schema contract. Exact CR-V1 field schemas are registered separately by
 * the server/tool registry when their operation contract is intentionally frozen. The model never
 * supplies or modifies this schema.
 */
export interface ActionInputSchema {
  readonly actionName: string;
  readonly schemaVersion: string;
  readonly fields: Readonly<Record<string, ActionInputFieldSpec>>;
  readonly allowUnknownFields?: false;
}

export type ActionInputValidationDecision =
  | { readonly decision: 'PASS'; readonly payload: Readonly<Record<string, unknown>> }
  | {
      readonly decision: 'DENY';
      readonly reason:
        | 'UNREGISTERED_ACTION'
        | 'ACTION_SCHEMA_VERSION_MISMATCH'
        | 'SCHEMA_ACTION_MISMATCH'
        | 'SCHEMA_VERSION_MISMATCH'
        | 'PAYLOAD_NOT_OBJECT'
        | 'AUTHORITY_FIELD_FORBIDDEN'
        | 'UNKNOWN_FIELD'
        | 'REQUIRED_FIELD_MISSING'
        | 'FIELD_TYPE_INVALID'
        | 'FIELD_LENGTH_INVALID';
      readonly field?: string;
    };

const FORBIDDEN_AUTHORITY_KEYS = new Set([
  'merchantworkspaceid',
  'requestedmerchantworkspaceid',
  'actoruserid',
  'actororganizationid',
  'membershipid',
  'permission',
  'permissions',
  'permissiongrants',
  'role',
  'roles',
  'approval',
  'approvalstatus',
  'executioncontext',
  'assurancelevel',
  'providercapability',
  'providersupportstate',
  'killswitch',
  'killswitches',
  'token',
  'accesstoken',
  'refreshtoken',
  'apikey',
  'apisecret',
  'secret',
  'credential',
  'credentials',
]);

function normalizedKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function findForbiddenAuthorityField(value: unknown, path = ''): string | null {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findForbiddenAuthorityField(value[index], `${path}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  if (!isPlainObject(value)) return null;
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (FORBIDDEN_AUTHORITY_KEYS.has(normalizedKey(key))) return childPath;
    const found = findForbiddenAuthorityField(child, childPath);
    if (found) return found;
  }
  return null;
}

function validType(value: unknown, type: ActionInputValueType): boolean {
  switch (type) {
    case 'string': return typeof value === 'string';
    case 'boolean': return typeof value === 'boolean';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'string_array': return Array.isArray(value) && value.every((item) => typeof item === 'string');
  }
}

function validateLength(value: unknown, spec: ActionInputFieldSpec): boolean {
  if (spec.minLength === undefined && spec.maxLength === undefined) return true;
  const length = typeof value === 'string' || Array.isArray(value) ? value.length : undefined;
  if (length === undefined) return true;
  if (spec.minLength !== undefined && length < spec.minLength) return false;
  if (spec.maxLength !== undefined && length > spec.maxLength) return false;
  return true;
}

export function validateActionInputAgainstSchema(input: {
  readonly payload: unknown;
  readonly schema: ActionInputSchema;
}): ActionInputValidationDecision {
  if (!isPlainObject(input.payload)) return { decision: 'DENY', reason: 'PAYLOAD_NOT_OBJECT' };

  const authorityField = findForbiddenAuthorityField(input.payload);
  if (authorityField) {
    return { decision: 'DENY', reason: 'AUTHORITY_FIELD_FORBIDDEN', field: authorityField };
  }

  for (const key of Object.keys(input.payload)) {
    if (!(key in input.schema.fields)) {
      return { decision: 'DENY', reason: 'UNKNOWN_FIELD', field: key };
    }
  }

  for (const [field, spec] of Object.entries(input.schema.fields)) {
    const value = input.payload[field];
    if (value === undefined) {
      if (spec.required) return { decision: 'DENY', reason: 'REQUIRED_FIELD_MISSING', field };
      continue;
    }
    if (!validType(value, spec.type)) {
      return { decision: 'DENY', reason: 'FIELD_TYPE_INVALID', field };
    }
    if (!validateLength(value, spec)) {
      return { decision: 'DENY', reason: 'FIELD_LENGTH_INVALID', field };
    }
  }

  return { decision: 'PASS', payload: Object.freeze({ ...input.payload }) };
}

export function validateRegisteredActionInput(input: {
  readonly actionName: string;
  readonly schemaVersion: string;
  readonly payload: unknown;
  readonly schema: ActionInputSchema;
}): ActionInputValidationDecision {
  const definition = getActionDefinition(input.actionName);
  if (!definition) return { decision: 'DENY', reason: 'UNREGISTERED_ACTION' };
  if (definition.inputSchemaVersion !== input.schemaVersion) {
    return { decision: 'DENY', reason: 'ACTION_SCHEMA_VERSION_MISMATCH' };
  }
  if (input.schema.actionName !== input.actionName) {
    return { decision: 'DENY', reason: 'SCHEMA_ACTION_MISMATCH' };
  }
  if (input.schema.schemaVersion !== input.schemaVersion) {
    return { decision: 'DENY', reason: 'SCHEMA_VERSION_MISMATCH' };
  }
  return validateActionInputAgainstSchema({ payload: input.payload, schema: input.schema });
}
