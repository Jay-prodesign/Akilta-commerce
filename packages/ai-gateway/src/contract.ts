import type { MerchantWorkspaceId, RunId, LocaleTag } from '../../domain/src';
import type { ApprovedFactSet } from '../../truth-policy/src';

export interface SafeConversationMessage {
  readonly role: 'customer' | 'assistant' | 'human';
  readonly text: string;
}

export interface SafeConversationContext {
  readonly messages: readonly SafeConversationMessage[];
  readonly summaryRef?: string;
}

export interface AiToolPolicy {
  /** Untrusted at runtime, same as AiGatewayCandidate.requestedTools[].toolName: remains string until registry validation via validateRegisteredToolSubset. */
  readonly allowedTools: readonly string[];
  /** AI Gateway can request registered tools but never receives authorization authority. */
  readonly actionAuthority: 'NONE';
}

export interface AiGatewayRequest {
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly runId: RunId;
  readonly locale: LocaleTag;
  readonly approvedFactSet: ApprovedFactSet;
  readonly conversationContext: SafeConversationContext;
  readonly responsePolicyRef: string;
  readonly toolPolicy: AiToolPolicy;
}

export interface CandidateClaim {
  readonly factClass: string;
  readonly factKey: string;
  readonly value: string;
}

export interface AiGatewayCandidate {
  readonly candidateText: string;
  readonly claimedFacts: readonly CandidateClaim[];
  /** Model output is untrusted at runtime, so toolName remains string until registry validation. */
  readonly requestedTools: readonly { toolName: string; argumentsRef: string }[];
  readonly providerRef: string;
  readonly modelRef: string;
}

export interface AiGateway {
  generateResponse(request: AiGatewayRequest): Promise<AiGatewayCandidate>;
}
