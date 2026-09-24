import { internalId } from '../../packages/domain/src/ids';
import { decideWebhookIngress } from '../../apps/api/src/webhook-boundary';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const workspaceA = internalId('mw-a', 'MerchantWorkspace');
const workspaceB = internalId('mw-b', 'MerchantWorkspace');
const integrationA = internalId('int-a', 'Integration');
const integrationB = internalId('int-b', 'Integration');
const bindingA = { integrationId: integrationA, merchantWorkspaceId: workspaceA } as const;

const scenarios: readonly [string, () => void][] = [
  ['WEBHOOK-UNVERIFIED-REJECTS-BEFORE-BINDING', () => {
    const result = decideWebhookIngress({ authenticity: 'UNVERIFIED', sourceEventRef: 'body-says-mw-a' });
    assert(result.decision === 'REJECT' && result.reason === 'AUTHENTICITY_NOT_VERIFIED', 'UNVERIFIED must reject first');
  }],
  ['WEBHOOK-INVALID-REJECTS-BEFORE-BINDING', () => {
    const result = decideWebhookIngress({ authenticity: 'INVALID', merchantWorkspaceId: workspaceA, integrationId: integrationA, serverResolvedIntegration: bindingA });
    assert(result.decision === 'REJECT' && result.reason === 'AUTHENTICITY_NOT_VERIFIED', 'INVALID must reject first');
  }],
  ['WEBHOOK-TENANT-MUST-BE-SERVER-RESOLVED', () => {
    const result = decideWebhookIngress({ authenticity: 'VERIFIED', integrationId: integrationA, serverResolvedIntegration: bindingA });
    assert(result.decision === 'REJECT' && result.reason === 'TENANT_NOT_RESOLVED', 'missing tenant must reject');
  }],
  ['WEBHOOK-INTEGRATION-CANDIDATE-MUST-EXIST', () => {
    const result = decideWebhookIngress({ authenticity: 'VERIFIED', merchantWorkspaceId: workspaceA, serverResolvedIntegration: bindingA });
    assert(result.decision === 'REJECT' && result.reason === 'INTEGRATION_NOT_RESOLVED', 'missing integration candidate must reject');
  }],
  ['WEBHOOK-CURRENT-INTEGRATION-BINDING-MUST-BE-LOADED', () => {
    const result = decideWebhookIngress({ authenticity: 'VERIFIED', merchantWorkspaceId: workspaceA, integrationId: integrationA });
    assert(result.decision === 'REJECT' && result.reason === 'INTEGRATION_BINDING_NOT_RESOLVED', 'missing current Integration binding must reject');
  }],
  ['WEBHOOK-INTEGRATION-ID-MISMATCH-FAILS-CLOSED', () => {
    const result = decideWebhookIngress({ authenticity: 'VERIFIED', merchantWorkspaceId: workspaceA, integrationId: integrationB, serverResolvedIntegration: bindingA });
    assert(result.decision === 'REJECT' && result.reason === 'INTEGRATION_ID_MISMATCH', 'routing candidate must match current Integration record');
  }],
  ['WEBHOOK-CROSS-WORKSPACE-BINDING-FAILS-CLOSED', () => {
    const result = decideWebhookIngress({ authenticity: 'VERIFIED', merchantWorkspaceId: workspaceB, integrationId: integrationA, serverResolvedIntegration: bindingA });
    assert(result.decision === 'REJECT' && result.reason === 'INTEGRATION_WORKSPACE_MISMATCH', 'Integration cannot be replayed across workspaces');
  }],
  ['WEBHOOK-SOURCE-EVENT-REF-CANNOT-SUBSTITUTE-FOR-BINDING', () => {
    const result = decideWebhookIngress({ authenticity: 'VERIFIED', merchantWorkspaceId: workspaceA, integrationId: integrationA, sourceEventRef: 'mw-a:int-a' });
    assert(result.decision === 'REJECT' && result.reason === 'INTEGRATION_BINDING_NOT_RESOLVED', 'provider/body refs are not binding authority');
  }],
  ['WEBHOOK-EXACT-CURRENT-BINDING-ALLOWS-NORMALIZE-AND-ENQUEUE', () => {
    const result = decideWebhookIngress({ authenticity: 'VERIFIED', merchantWorkspaceId: workspaceA, integrationId: integrationA, serverResolvedIntegration: bindingA, sourceEventRef: 'evt-1' });
    assert(result.decision === 'ALLOW_NORMALIZE_AND_ENQUEUE', 'exact current binding should allow');
    if (result.decision === 'ALLOW_NORMALIZE_AND_ENQUEUE') {
      assert(result.merchantWorkspaceId === workspaceA && result.integrationId === integrationA, 'allow result must use server-resolved binding');
    }
  }],
];

for (const [id, run] of scenarios) {
  try { run(); }
  catch (error) { throw new Error(`${id}: ${error instanceof Error ? error.message : String(error)}`); }
}
console.log(`webhook-ingress-boundary: ${scenarios.length}/${scenarios.length} PASS`);
