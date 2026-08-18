import {
  containsUnresolvedTemplateSyntax,
  resolveFactCandidates,
  type FactCandidate,
  type TruthAuthorityPolicy,
} from '../../packages/truth-policy/src/truth';
import { internalId, utcTimestamp } from '../../packages/domain/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const policy: readonly TruthAuthorityPolicy[] = [
  { factClass: 'policy', orderedAuthorityClasses: ['LIVE_PROVIDER'] },
];
const base = {
  factClass: 'policy',
  factKey: 'privacy.summary',
  evidenceRef: 'shopify-policy-e3',
  authorityClass: 'LIVE_PROVIDER',
  approvalState: 'APPROVED',
  freshnessState: 'FRESH',
} as const;

assert(!containsUnresolvedTemplateSyntax('Returns are accepted within 14 days.'), 'plain policy must be resolved material');
assert(containsUnresolvedTemplateSyntax('Contact {{ shop_name }} for support.'), 'Liquid/Mustache variable must be detected');
assert(containsUnresolvedTemplateSyntax('{% if selling_to_europe %}EEA rights{% endif %}'), 'Liquid block must be detected');
assert(containsUnresolvedTemplateSyntax('{# hidden conditional source #}'), 'template comment must be detected');
assert(!containsUnresolvedTemplateSyntax('Size {L} is available.'), 'ordinary single braces must not be rejected');

function resolve(candidate: FactCandidate) {
  return resolveFactCandidates({
    approvedFactSetId: internalId('afs-template-test', 'ApprovedFactSet'),
    merchantWorkspaceId: internalId('mw-template-test', 'MerchantWorkspace'),
    intent: 'policy_answer',
    policies: policy,
    requestedFacts: [{ factClass: 'policy', factKey: 'privacy.summary' }],
    candidates: [candidate],
    generatedAt: utcTimestamp('2026-08-09T20:30:00+03:00'),
  });
}

const plain = resolve({ ...base, value: 'Returns are accepted within 14 days.' });
assert(plain.resolvedFacts.length === 1 && plain.unknowns.length === 0, 'plain approved fresh policy should resolve');

const variable = resolve({ ...base, value: 'Contact {{ shop_name }} for support.' });
assert(variable.resolvedFacts.length === 0 && variable.unknowns.length === 1, 'unresolved variable policy must fail closed to UNKNOWN');

const conditional = resolve({ ...base, value: '{% if selling_to_europe %}EEA rights{% endif %}' });
assert(conditional.resolvedFacts.length === 0 && conditional.unknowns.length === 1, 'conditional template policy must fail closed to UNKNOWN');

const stale = resolve({ ...base, value: 'Plain policy', freshnessState: 'STALE' });
assert(stale.resolvedFacts.length === 0 && stale.unknowns.length === 1, 'existing freshness gate must remain fail closed');

console.log('truth-template-safety: 9/9 PASS');
