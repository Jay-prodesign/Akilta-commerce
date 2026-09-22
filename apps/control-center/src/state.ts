import type {
  ConversationOwnershipState,
  MerchantWorkspaceId,
  SupportState,
  WorkspaceReadinessState,
} from '../../../packages/domain/src';

export interface StatusPresentation {
  readonly semantic: 'READY' | 'INFO' | 'WARNING' | 'BLOCKED' | 'ERROR';
  readonly label: string;
  /** Must be rendered as visible text/icon semantics, never color-only. */
  readonly requiresTextLabel: true;
}

export function capabilityPresentation(state: SupportState): StatusPresentation {
  switch (state) {
    case 'AVAILABLE': return { semantic: 'READY', label: 'Available', requiresTextLabel: true };
    case 'UNSUPPORTED': return { semantic: 'BLOCKED', label: 'Unsupported', requiresTextLabel: true };
    case 'UNKNOWN': return { semantic: 'WARNING', label: 'Unknown / not verified', requiresTextLabel: true };
    case 'STALE': return { semantic: 'WARNING', label: 'Stale evidence', requiresTextLabel: true };
    case 'ERROR': return { semantic: 'ERROR', label: 'Provider error', requiresTextLabel: true };
    case 'BLOCKED_BY_ACCESS': return { semantic: 'BLOCKED', label: 'Access required', requiresTextLabel: true };
  }
}

export function readinessPresentation(state: WorkspaceReadinessState): StatusPresentation {
  switch (state) {
    case 'NOT_STARTED': return { semantic: 'INFO', label: 'Not started', requiresTextLabel: true };
    case 'IN_PROGRESS': return { semantic: 'INFO', label: 'In progress', requiresTextLabel: true };
    case 'BLOCKED_BY_ACCESS': return { semantic: 'BLOCKED', label: 'Blocked by access', requiresTextLabel: true };
    case 'READY_FOR_TEST': return { semantic: 'WARNING', label: 'Ready for test', requiresTextLabel: true };
    case 'PILOT_READY': return { semantic: 'READY', label: 'Pilot ready', requiresTextLabel: true };
    case 'DEGRADED': return { semantic: 'WARNING', label: 'Degraded', requiresTextLabel: true };
  }
}

export type ComposerUiMode = 'AI_CANDIDATE' | 'HUMAN_REPLY' | 'SUGGEST_ONLY' | 'DISABLED';

/** UI hint only. Server rechecks ownership/authz at send time. */
export function composerUiMode(state: ConversationOwnershipState): ComposerUiMode {
  switch (state) {
    case 'AI_ACTIVE':
    case 'AI_ACTIVE_RESTORED':
      return 'AI_CANDIDATE';
    case 'HUMAN_ASSIGNED':
    case 'HUMAN_ACTIVE':
      return 'HUMAN_REPLY';
    case 'AI_SUGGEST_ONLY':
    case 'HANDOFF_REQUESTED':
    case 'RETURN_TO_AI_PENDING':
      return 'SUGGEST_ONLY';
    case 'CLOSED':
      return 'DISABLED';
  }
}

export interface WorkspaceSwitchResetPlan {
  readonly from: MerchantWorkspaceId | null;
  readonly to: MerchantWorkspaceId;
  readonly clearConversationSelection: boolean;
  readonly clearCustomerContext: boolean;
  readonly clearDrafts: boolean;
  readonly clearEvidenceCache: boolean;
  readonly refetchServerAuthority: boolean;
}

export function workspaceSwitchResetPlan(
  from: MerchantWorkspaceId | null,
  to: MerchantWorkspaceId,
): WorkspaceSwitchResetPlan {
  const changed = from !== to;
  return Object.freeze({
    from,
    to,
    clearConversationSelection: changed,
    clearCustomerContext: changed,
    clearDrafts: changed,
    clearEvidenceCache: changed,
    refetchServerAuthority: true,
  });
}
