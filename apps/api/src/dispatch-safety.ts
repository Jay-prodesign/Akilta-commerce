import { evaluateActionSafety, type ActionSafetyInput } from './action-engine';
import type { ErrorCode } from '../../../packages/domain/src/errors';

export type RevalidateBeforeDispatchDecision =
  | { readonly decision: 'ALLOW' }
  | { readonly decision: 'DENY'; readonly reason: string; readonly code: Extract<ErrorCode, 'DISPATCH_REVALIDATION_DENIED'> };

export interface RevalidateBeforeDispatchInput extends ActionSafetyInput {
  /** Forwarded for the caller's own observability; not evaluated here. */
  readonly attempt?: number;
}

/**
 * D-090 I3 / RG-AUTH-RACE: immediately before a queued or retried external effect
 * actually dispatches, revalidate current permission/approval/entitlement/capability/
 * ProcessingPolicy/integration/freshness/kill-switch state.
 *
 * This is a second, independent call into the exact same evaluateActionSafety
 * composition action-engine.ts uses at plan-prepare time -- it does not cache or
 * trust the earlier prepare-time result. The caller must supply freshly-resolved
 * state (current ExecutionContext, current ApprovalSnapshot, current
 * SafetySwitchSnapshot[]), not the snapshot captured when the plan was first
 * prepared, so anything that changed since prepare (approval revoked/expired,
 * membership deactivated, kill switch flipped to STOP, capability support lost)
 * is caught here even though the original prepare-time check passed.
 *
 * At dispatch/retry time there is no user turn left to satisfy a newly-required
 * approval, so APPROVAL_REQUIRED fails closed as DENY rather than pausing.
 */
export function revalidateBeforeDispatch(
  input: RevalidateBeforeDispatchInput,
): RevalidateBeforeDispatchDecision {
  const safety = evaluateActionSafety(input);
  if (safety.decision === 'ALLOW') return { decision: 'ALLOW' };
  if (safety.decision === 'APPROVAL_REQUIRED') {
    return { decision: 'DENY', reason: `APPROVAL_REQUIRED_AT_DISPATCH:${safety.reason}`, code: 'DISPATCH_REVALIDATION_DENIED' };
  }
  return { decision: 'DENY', reason: safety.reason, code: 'DISPATCH_REVALIDATION_DENIED' };
}
