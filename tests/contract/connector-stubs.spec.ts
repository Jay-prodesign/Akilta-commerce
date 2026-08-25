import { connectorCapability } from '../../packages/commerce-contract/src';
import { internalId, utcTimestamp } from '../../packages/domain/src';
import { createTicimaxEvidenceGatedStub, TICIMAX_STAGING_CAPABILITIES } from '../../connectors/ticimax/src';
import { createIdeaSoftEvidenceGatedStub, IDEASOFT_STAGING_CAPABILITIES } from '../../connectors/ideasoft/src';
import { createShopifyEvidenceGatedStub, SHOPIFY_STAGING_CAPABILITIES } from '../../connectors/shopify/src';
import { metaWhatsAppEvidenceGatedResult } from '../../connectors/meta-whatsapp/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  let definitiveWithoutEvidenceRejected = false;
  try {
    connectorCapability({ operationId: 'get_product', supportState: 'AVAILABLE', limitations: [] });
  } catch {
    definitiveWithoutEvidenceRejected = true;
  }
  assert(definitiveWithoutEvidenceRejected, 'AVAILABLE must require evidence');

  const ws = internalId('mw_test', 'MerchantWorkspace');
  const iid = internalId('int_test', 'Integration');
  const now = () => utcTimestamp('2026-08-07T18:00:00.000Z');

  const ticimax = createTicimaxEvidenceGatedStub({ merchantWorkspaceId: ws, integrationId: iid, now });
  const tiResult = await ticimax.execute('get_product', { productRef: 'normalized-only' });
  assert(tiResult.status === 'BLOCKED_BY_ACCESS', 'Ticimax stub must fail closed');
  assert(TICIMAX_STAGING_CAPABILITIES.every((c) => c.supportState !== 'AVAILABLE'), 'Ticimax must not advertise executable AVAILABLE before evidence');

  const ideasoft = createIdeaSoftEvidenceGatedStub({ merchantWorkspaceId: ws, integrationId: iid, now });
  const idResult = await ideasoft.execute('get_order', { orderRef: 'normalized-only' });
  assert(idResult.status === 'BLOCKED_BY_ACCESS', 'IdeaSoft stub must fail closed');
  assert(IDEASOFT_STAGING_CAPABILITIES.every((c) => c.supportState !== 'AVAILABLE'), 'IdeaSoft must not advertise executable AVAILABLE before evidence');

  const shopify = createShopifyEvidenceGatedStub({ merchantWorkspaceId: ws, integrationId: iid, now });
  const shResult = await shopify.execute('get_order', { orderRef: 'normalized-only' });
  assert(shResult.status === 'BLOCKED_BY_ACCESS', 'Shopify stub must fail closed');
  assert(SHOPIFY_STAGING_CAPABILITIES.every((c) => c.supportState !== 'AVAILABLE'), 'Shopify must not advertise executable AVAILABLE before evidence');
  assert(shopify.identity.provider === 'shopify', 'Shopify stub must self-identify as shopify');

  const meta = metaWhatsAppEvidenceGatedResult(now());
  assert(meta.status === 'BLOCKED_BY_ACCESS', 'Meta stub must fail closed');
  assert(meta.evidenceRefs.length === 0, 'Meta stub cannot fabricate evidence refs');

  console.log('connector-stubs: 8/8 PASS');
}

void main();
