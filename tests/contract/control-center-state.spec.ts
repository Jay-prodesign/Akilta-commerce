import { internalId } from '../../packages/domain/src';
import {
  CONTROL_CENTER_ROUTES,
  capabilityPresentation,
  composerUiMode,
  readinessPresentation,
  workspaceSwitchResetPlan,
} from '../../apps/control-center/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(capabilityPresentation('UNKNOWN').semantic === 'WARNING', 'UNKNOWN must not render as ready');
assert(capabilityPresentation('BLOCKED_BY_ACCESS').semantic === 'BLOCKED', 'blocked access must be explicit');
assert(capabilityPresentation('AVAILABLE').requiresTextLabel, 'status must not be color-only');
assert(readinessPresentation('READY_FOR_TEST').semantic !== 'READY', 'READY_FOR_TEST is not PILOT_READY');
assert(composerUiMode('HUMAN_ACTIVE') === 'HUMAN_REPLY', 'human ownership must not show AI autonomous mode');
assert(composerUiMode('HANDOFF_REQUESTED') === 'SUGGEST_ONLY', 'handoff pending must suppress autonomous mode');
assert(composerUiMode('CLOSED') === 'DISABLED', 'closed conversation composer disabled');

const a = internalId('workspace-a', 'MerchantWorkspace');
const b = internalId('workspace-b', 'MerchantWorkspace');
const changed = workspaceSwitchResetPlan(a, b);
assert(changed.clearCustomerContext && changed.clearDrafts && changed.clearEvidenceCache, 'workspace switch must clear tenant-sensitive client state');
assert(changed.refetchServerAuthority, 'workspace selection requires server authority refresh');
const same = workspaceSwitchResetPlan(a, a);
assert(!same.clearCustomerContext && same.refetchServerAuthority, 'same workspace may preserve cache but server remains authority');
assert(CONTROL_CENTER_ROUTES.includes('/approvals'), 'approval route must exist');
assert(CONTROL_CENTER_ROUTES.includes('/integrations'), 'integration route must exist');

console.log('control-center-state: 12/12 PASS');
