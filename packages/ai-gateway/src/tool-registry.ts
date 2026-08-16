export const CRV1_AI_TOOL_NAMES = [
  'get_product',
  'get_variant_stock',
  'search_catalog',
  'get_policy',
  'search_approved_knowledge',
  'get_customer_context',
  'list_authorized_customer_orders',
  'get_order',
  'get_tracking',
  'create_handoff',
  'create_rule_candidate',
] as const;
export type Crv1AiToolName = (typeof CRV1_AI_TOOL_NAMES)[number];

export type AiToolExecutionClass = 'READ_ONLY' | 'GOVERNED_INTERNAL_PROPOSAL';

export interface AiToolDefinition {
  readonly toolName: Crv1AiToolName;
  readonly contractVersion: '1';
  readonly inputContractRef: string;
  readonly returnContractRef: string;
  readonly executionClass: AiToolExecutionClass;
  readonly modelExposure: 'CANDIDATE_ONLY';
  readonly actionAuthority: 'NONE';
  readonly requiresServerValidation: true;
  readonly preservesUnknownUnsupportedErrorStates: true;
  readonly requiresFreshnessMetadata: true;
  readonly requiresEvidenceMetadata: true;
}

const proposalTools = new Set<Crv1AiToolName>(['create_handoff', 'create_rule_candidate']);

export const CRV1_AI_TOOL_DEFINITIONS: readonly AiToolDefinition[] = Object.freeze(
  CRV1_AI_TOOL_NAMES.map((toolName) =>
    Object.freeze({
      toolName,
      contractVersion: '1' as const,
      inputContractRef: `internal:${toolName}:input:v1`,
      returnContractRef: `internal:${toolName}:return:v1`,
      executionClass: proposalTools.has(toolName)
        ? ('GOVERNED_INTERNAL_PROPOSAL' as const)
        : ('READ_ONLY' as const),
      modelExposure: 'CANDIDATE_ONLY' as const,
      actionAuthority: 'NONE' as const,
      requiresServerValidation: true as const,
      preservesUnknownUnsupportedErrorStates: true as const,
      requiresFreshnessMetadata: true as const,
      requiresEvidenceMetadata: true as const,
    }),
  ),
);

const toolRegistry = new Map<Crv1AiToolName, AiToolDefinition>(
  CRV1_AI_TOOL_DEFINITIONS.map((definition) => [definition.toolName, definition]),
);

const FORBIDDEN_GENERAL_PURPOSE_TOOL_NAMES = new Set([
  'arbitrary_sql',
  'arbitrary_http',
  'arbitrary_http_fetch',
  'set_permission',
  'switch_tenant',
  'raw_provider_mutation',
  'read_secret',
  'execute_shell',
  'unregistered_action',
]);

export function isCrv1AiToolName(value: string): value is Crv1AiToolName {
  return toolRegistry.has(value as Crv1AiToolName);
}

export function getAiToolDefinition(value: string): AiToolDefinition | null {
  return isCrv1AiToolName(value) ? toolRegistry.get(value) ?? null : null;
}

export function isExplicitlyForbiddenGeneralPurposeTool(value: string): boolean {
  return FORBIDDEN_GENERAL_PURPOSE_TOOL_NAMES.has(value);
}

export type ToolSubsetValidation =
  | { readonly result: 'PASS'; readonly allowedTools: readonly Crv1AiToolName[] }
  | {
      readonly result: 'FAIL';
      readonly reason: 'UNREGISTERED_TOOL' | 'FORBIDDEN_TOOL' | 'DUPLICATE_TOOL';
      readonly toolName: string;
    };

export function validateRegisteredToolSubset(values: readonly string[]): ToolSubsetValidation {
  const seen = new Set<string>();
  const allowed: Crv1AiToolName[] = [];
  for (const value of values) {
    if (isExplicitlyForbiddenGeneralPurposeTool(value)) {
      return { result: 'FAIL', reason: 'FORBIDDEN_TOOL', toolName: value };
    }
    if (!isCrv1AiToolName(value)) {
      return { result: 'FAIL', reason: 'UNREGISTERED_TOOL', toolName: value };
    }
    if (seen.has(value)) {
      return { result: 'FAIL', reason: 'DUPLICATE_TOOL', toolName: value };
    }
    seen.add(value);
    allowed.push(value);
  }
  return { result: 'PASS', allowedTools: Object.freeze(allowed) };
}
