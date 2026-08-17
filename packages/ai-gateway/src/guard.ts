import type { ErrorCode } from '../../domain/src/errors';
import type { AiGatewayCandidate, AiGatewayRequest, CandidateClaim } from './contract';
import { isCrv1AiToolName, validateRegisteredToolSubset } from './tool-registry';

export type AiCandidateCheck =
  | { readonly result: 'PASS' }
  | { readonly result: 'FAIL'; readonly code: Extract<ErrorCode, 'AI_OUTPUT_POLICY_FAIL' | 'AI_OUTPUT_GROUNDEDNESS_FAIL'>; readonly reason: string };

const RESERVED_AUTHORITY_PREFIXES = ['permission.', 'tenant.', 'action.authorized', 'secret.'];

export function isToolAllowed(request: AiGatewayRequest, toolName: string): boolean {
  if (request.toolPolicy.actionAuthority !== 'NONE') return false;
  const policy = validateRegisteredToolSubset(request.toolPolicy.allowedTools);
  if (policy.result === 'FAIL') return false;
  if (!isCrv1AiToolName(toolName)) return false;
  return policy.allowedTools.includes(toolName);
}

export function checkCandidateClaim(request: AiGatewayRequest, claim: CandidateClaim): AiCandidateCheck {
  if (RESERVED_AUTHORITY_PREFIXES.some((prefix) => claim.factKey.startsWith(prefix))) {
    return { result: 'FAIL', code: 'AI_OUTPUT_POLICY_FAIL', reason: 'AI cannot create authorization/tenant/secret facts' };
  }
  if (request.approvedFactSet.unknowns.some((item) => item.factClass === claim.factClass && item.factKey === claim.factKey)) {
    return { result: 'FAIL', code: 'AI_OUTPUT_GROUNDEDNESS_FAIL', reason: 'Claim references an UNKNOWN fact' };
  }
  if (request.approvedFactSet.conflicts.some((item) => item.factClass === claim.factClass && item.factKey === claim.factKey)) {
    return { result: 'FAIL', code: 'AI_OUTPUT_GROUNDEDNESS_FAIL', reason: 'Claim references a conflicting fact' };
  }
  const resolved = request.approvedFactSet.resolvedFacts.find(
    (fact) => fact.factClass === claim.factClass && fact.factKey === claim.factKey,
  );
  if (!resolved || resolved.value !== claim.value) {
    return { result: 'FAIL', code: 'AI_OUTPUT_GROUNDEDNESS_FAIL', reason: 'Claim does not exactly match ApprovedFactSet' };
  }
  return { result: 'PASS' };
}

export function checkAiCandidate(request: AiGatewayRequest, candidate: AiGatewayCandidate): AiCandidateCheck {
  const policy = validateRegisteredToolSubset(request.toolPolicy.allowedTools);
  if (policy.result === 'FAIL') {
    return { result: 'FAIL', code: 'AI_OUTPUT_POLICY_FAIL', reason: `Invalid tool policy: ${policy.reason}:${policy.toolName}` };
  }
  for (const tool of candidate.requestedTools) {
    if (!isToolAllowed(request, tool.toolName)) {
      return { result: 'FAIL', code: 'AI_OUTPUT_POLICY_FAIL', reason: `Tool not allowed: ${tool.toolName}` };
    }
  }
  for (const claim of candidate.claimedFacts) {
    const result = checkCandidateClaim(request, claim);
    if (result.result === 'FAIL') return result;
  }
  return { result: 'PASS' };
}
