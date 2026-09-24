export interface OutboundUrlPolicy {
  readonly allowedHosts?: readonly string[];
  readonly requireHttps: boolean;
}

export type OutboundUrlDecision =
  | { readonly decision: 'PASS_PREFLIGHT'; readonly requiresRuntimeDnsAndRedirectValidation: true }
  | { readonly decision: 'DENY'; readonly reason: string };

function isBlockedIpv4(host: string): boolean {
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return false;
  const a = parts[0];
  const b = parts[1];
  if (a === undefined || b === undefined) return false;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function isBlockedIpv6(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  return h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe8') || h.startsWith('fe9') || h.startsWith('fea') || h.startsWith('feb');
}

export function validateOutboundUrl(urlText: string, policy: OutboundUrlPolicy): OutboundUrlDecision {
  let url: URL;
  try { url = new URL(urlText); } catch { return { decision: 'DENY', reason: 'INVALID_URL' }; }
  if (policy.requireHttps && url.protocol !== 'https:') return { decision: 'DENY', reason: 'HTTPS_REQUIRED' };
  if (!['https:', 'http:'].includes(url.protocol)) return { decision: 'DENY', reason: 'SCHEME_NOT_ALLOWED' };
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return { decision: 'DENY', reason: 'LOCAL_HOST_BLOCKED' };
  if (isBlockedIpv4(host) || isBlockedIpv6(host)) return { decision: 'DENY', reason: 'PRIVATE_OR_LINK_LOCAL_ADDRESS_BLOCKED' };
  if (policy.allowedHosts && !policy.allowedHosts.map((h) => h.toLowerCase()).includes(host)) return { decision: 'DENY', reason: 'HOST_NOT_ALLOWLISTED' };
  return { decision: 'PASS_PREFLIGHT', requiresRuntimeDnsAndRedirectValidation: true };
}
