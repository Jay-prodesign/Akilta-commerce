import {
  CRV1_AI_TOOL_DEFINITIONS,
  CRV1_AI_TOOL_NAMES,
  getAiToolDefinition,
  isCrv1AiToolName,
  isExplicitlyForbiddenGeneralPurposeTool,
  validateRegisteredToolSubset,
} from '../../packages/ai-gateway/src/tool-registry';
import { checkAiCandidate, isToolAllowed } from '../../packages/ai-gateway/src/guard';
import type { AiGatewayRequest } from '../../packages/ai-gateway/src/contract';

let passed = 0;
function assert(condition: unknown, name: string): void {
  if (!condition) throw new Error(`FAIL:${name}`);
  passed += 1;
}

assert(CRV1_AI_TOOL_NAMES.length === 11, 'candidate-tool-count');
assert(new Set(CRV1_AI_TOOL_NAMES).size === CRV1_AI_TOOL_NAMES.length, 'registry-names-unique');
assert(CRV1_AI_TOOL_DEFINITIONS.length === CRV1_AI_TOOL_NAMES.length, 'definition-count-matches');
assert(CRV1_AI_TOOL_DEFINITIONS.every((d) => d.actionAuthority === 'NONE' && d.modelExposure === 'CANDIDATE_ONLY'), 'no-model-action-authority');
assert(CRV1_AI_TOOL_DEFINITIONS.every((d) => d.inputContractRef && d.returnContractRef), 'contract-refs-required');
assert(CRV1_AI_TOOL_DEFINITIONS.every((d) => d.requiresFreshnessMetadata && d.requiresEvidenceMetadata && d.preservesUnknownUnsupportedErrorStates), 'evidence-freshness-unknown-contract');
assert(getAiToolDefinition('get_product')?.executionClass === 'READ_ONLY', 'read-tool-registered');
assert(getAiToolDefinition('create_rule_candidate')?.executionClass === 'GOVERNED_INTERNAL_PROPOSAL', 'proposal-tool-registered');
assert(getAiToolDefinition('arbitrary_sql') === null, 'forbidden-not-registered');
assert(isExplicitlyForbiddenGeneralPurposeTool('execute_shell'), 'execute-shell-forbidden');
assert(!isCrv1AiToolName('made_up_tool'), 'unknown-not-registered');
const subset = validateRegisteredToolSubset(['get_product', 'get_order']);
assert(subset.result === 'PASS' && subset.allowedTools.length === 2, 'registered-subset-pass');
assert(validateRegisteredToolSubset(['get_product', 'get_product']).result === 'FAIL', 'duplicate-subset-fails');
assert(validateRegisteredToolSubset(['arbitrary_http']).result === 'FAIL', 'forbidden-subset-fails');
assert(validateRegisteredToolSubset(['made_up_tool']).result === 'FAIL', 'unknown-subset-fails');

const request = {
  merchantWorkspaceId: 'mw-1',
  runId: 'run-1',
  locale: 'tr-TR',
  approvedFactSet: { unknowns: [], conflicts: [], resolvedFacts: [] },
  conversationContext: { messages: [] },
  responsePolicyRef: 'policy-1',
  toolPolicy: { allowedTools: ['get_product'], actionAuthority: 'NONE' },
} as AiGatewayRequest;
assert(isToolAllowed(request, 'get_product'), 'registered-allowed-tool-passes');
assert(!isToolAllowed(request, 'get_order'), 'registered-but-unexposed-fails');
assert(!isToolAllowed(request, 'made_up_tool'), 'unregistered-candidate-fails');

const forgedPolicyRequest = {
  ...request,
  toolPolicy: { allowedTools: ['get_product', 'made_up_tool'], actionAuthority: 'NONE' },
} as unknown as AiGatewayRequest;
assert(!isToolAllowed(forgedPolicyRequest, 'get_product'), 'invalid-policy-fails-closed');
const candidate = { candidateText: '', claimedFacts: [], requestedTools: [{ toolName: 'get_product', argumentsRef: 'args-1' }], providerRef: 'p', modelRef: 'm' };
assert(checkAiCandidate(forgedPolicyRequest, candidate).result === 'FAIL', 'candidate-rejected-on-invalid-policy');

console.log(`PASS ${passed}/20`);
