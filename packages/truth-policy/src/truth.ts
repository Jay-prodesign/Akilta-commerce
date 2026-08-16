import type {
  ApprovedFactSetId,
  MerchantWorkspaceId,
  UtcTimestamp,
} from '../../domain/src';

export type FactAuthorityClass = string;
export type FactApprovalState = 'APPROVED' | 'CANDIDATE' | 'REJECTED';
export type FactFreshnessState = 'FRESH' | 'STALE' | 'UNKNOWN';

/**
 * Fail closed on unresolved template source material (Liquid/Mustache/Jinja-style syntax).
 * Provider-authentic raw policy/content can contain conditional placeholders and must not
 * become customer-visible resolved truth until rendered/evaluated upstream.
 */
export function containsUnresolvedTemplateSyntax(value: string): boolean {
  return /\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}|\{#[\s\S]*?#\}/.test(value);
}

export interface FactCandidate {
  readonly factClass: string;
  readonly factKey: string;
  readonly value: string;
  readonly evidenceRef: string;
  readonly authorityClass: FactAuthorityClass;
  readonly approvalState: FactApprovalState;
  readonly freshnessState: FactFreshnessState;
  readonly retrievalScore?: number; // Diagnostic only; never authority.
}

export interface TruthAuthorityPolicy {
  readonly factClass: string;
  /** Strongest first. Policy is deterministic/configured, never model-generated. */
  readonly orderedAuthorityClasses: readonly FactAuthorityClass[];
}

export interface ResolvedFact {
  readonly factClass: string;
  readonly factKey: string;
  readonly value: string;
  readonly evidenceRefs: readonly string[];
  readonly authorityClass: FactAuthorityClass;
}

export interface FactConflict {
  readonly factClass: string;
  readonly factKey: string;
  readonly authorityClass: FactAuthorityClass;
  readonly competingValues: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface ApprovedFactSet {
  readonly approvedFactSetId: ApprovedFactSetId;
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly intent: string;
  readonly resolvedFacts: readonly ResolvedFact[];
  readonly unknowns: readonly { factClass: string; factKey: string }[];
  readonly conflicts: readonly FactConflict[];
  readonly generatedAt: UtcTimestamp;
  readonly freshnessSummary: 'FRESH' | 'HAS_UNKNOWN_OR_STALE';
}

export function resolveFactCandidates(input: {
  readonly approvedFactSetId: ApprovedFactSetId;
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly intent: string;
  readonly policies: readonly TruthAuthorityPolicy[];
  readonly requestedFacts: readonly { factClass: string; factKey: string }[];
  readonly candidates: readonly FactCandidate[];
  readonly generatedAt: UtcTimestamp;
}): ApprovedFactSet {
  const resolvedFacts: ResolvedFact[] = [];
  const unknowns: { factClass: string; factKey: string }[] = [];
  const conflicts: FactConflict[] = [];

  for (const requested of input.requestedFacts) {
    const policy = input.policies.find((p) => p.factClass === requested.factClass);
    if (!policy) {
      unknowns.push(requested);
      continue;
    }
    const eligible = input.candidates.filter(
      (candidate) =>
        candidate.factClass === requested.factClass &&
        candidate.factKey === requested.factKey &&
        candidate.approvalState === 'APPROVED' &&
        candidate.freshnessState === 'FRESH' &&
        !containsUnresolvedTemplateSyntax(candidate.value) &&
        policy.orderedAuthorityClasses.includes(candidate.authorityClass),
    );
    if (eligible.length === 0) {
      unknowns.push(requested);
      continue;
    }
    let winningAuthority: string | undefined;
    for (const authority of policy.orderedAuthorityClasses) {
      if (eligible.some((candidate) => candidate.authorityClass === authority)) {
        winningAuthority = authority;
        break;
      }
    }
    if (!winningAuthority) {
      unknowns.push(requested);
      continue;
    }
    const winners = eligible.filter((candidate) => candidate.authorityClass === winningAuthority);
    const values = [...new Set(winners.map((candidate) => candidate.value))];
    const evidenceRefs = [...new Set(winners.map((candidate) => candidate.evidenceRef))];
    if (values.length !== 1) {
      conflicts.push({
        factClass: requested.factClass,
        factKey: requested.factKey,
        authorityClass: winningAuthority,
        competingValues: values,
        evidenceRefs,
      });
      continue;
    }
    const resolvedValue = values[0];
    if (resolvedValue === undefined) {
      unknowns.push(requested);
      continue;
    }
    resolvedFacts.push({
      factClass: requested.factClass,
      factKey: requested.factKey,
      value: resolvedValue,
      evidenceRefs,
      authorityClass: winningAuthority,
    });
  }

  return Object.freeze({
    approvedFactSetId: input.approvedFactSetId,
    merchantWorkspaceId: input.merchantWorkspaceId,
    intent: input.intent,
    resolvedFacts,
    unknowns,
    conflicts,
    generatedAt: input.generatedAt,
    freshnessSummary: unknowns.length || conflicts.length ? 'HAS_UNKNOWN_OR_STALE' : 'FRESH',
  });
}
