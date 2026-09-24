import { decideWebhookIngress, safeHttpErrorEnvelope } from '../../apps/api/src';
import { CRV1_AI_TOOL_NAMES, isExplicitlyForbiddenGeneralPurposeTool } from '../../packages/ai-gateway/src';
import { internalId } from '../../packages/domain/src';
import { LOGICAL_ASYNC_TOPICS } from '../../packages/events/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const workspace = internalId('mw-a', 'MerchantWorkspace');
const integration = internalId('int-a', 'Integration');

const invalid = decideWebhookIngress({ authenticity: 'INVALID', merchantWorkspaceId: workspace, integrationId: integration });
assert(invalid.decision === 'REJECT', 'IF-01 invalid authenticity must reject before enqueue');

const unresolvedTenant = decideWebhookIngress({ authenticity: 'VERIFIED', integrationId: integration });
assert(unresolvedTenant.decision === 'REJECT' && unresolvedTenant.reason === 'TENANT_NOT_RESOLVED', 'tenant must be server resolved');

const valid = decideWebhookIngress({
  authenticity: 'VERIFIED',
  merchantWorkspaceId: workspace,
  integrationId: integration,
  serverResolvedIntegration: { integrationId: integration, merchantWorkspaceId: workspace },
});
assert(valid.decision === 'ALLOW_NORMALIZE_AND_ENQUEUE', 'verified + tenant/integration + current binding may proceed to normalized enqueue');

const error = safeHttpErrorEnvelope({
  code: 'AUTH_PERMISSION_DENIED',
  requestId: internalId('req-1', 'Request'),
  retryable: false,
  requiredAction: 'NONE',
  locale: 'tr',
  message: 'accessToken=secret rawException=boom',
} as Parameters<typeof safeHttpErrorEnvelope>[0] & { message: string });
assert(!('providerToken' in error) && !('rawException' in error), 'safe error envelope cannot expose raw secret/error fields');
assert(error.message === 'İşlem tamamlanamadı.' && !error.message.includes('secret'), 'caller error text leaked into public response');

assert(LOGICAL_ASYNC_TOPICS.includes('dead_letter.quarantine'), 'IF-08 dead-letter logical route must exist');
assert(CRV1_AI_TOOL_NAMES.includes('get_product'), 'bounded AI tools must include product read');
assert(isExplicitlyForbiddenGeneralPurposeTool('switch_tenant'), 'IF-12 switch_tenant must be forbidden');
assert(isExplicitlyForbiddenGeneralPurposeTool('arbitrary_http'), 'arbitrary HTTP must be forbidden');

console.log('interface-boundary: 8/8 PASS');
