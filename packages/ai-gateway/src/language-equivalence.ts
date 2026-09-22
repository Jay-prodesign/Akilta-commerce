export type CriticalScalar = string | number | boolean | null;

export type ActionAuthorityState =
  | 'NO_ACTION'
  | 'ALLOW_READ_ONLY'
  | 'HANDOFF_REQUIRED'
  | 'APPROVAL_REQUIRED'
  | 'DENY';

export type CustomerVerificationLevel = 'CV0' | 'CV1' | 'CV2' | 'CV3';

export interface CriticalFactAtom {
  readonly key: string;
  readonly value: CriticalScalar;
  readonly authorityRef: string;
}

/**
 * Language-specific text is intentionally excluded from equality authority.
 * This structure is emitted by the response layer before natural-language rendering
 * and re-attached to the rendered candidate for deterministic post-checking.
 */
export interface CriticalResponseSnapshot {
  readonly locale: 'tr-TR' | 'en-US';
  readonly factSetRef: string;
  readonly facts: readonly CriticalFactAtom[];
  readonly exactIdentifiers: readonly string[];
  readonly exactVariantLabels: readonly string[];
  readonly unknownRefs: readonly string[];
  readonly conflictRefs: readonly string[];
  readonly policyCommitmentRefs: readonly string[];
  readonly customerVerificationLevel: CustomerVerificationLevel;
  readonly actionAuthorityState: ActionAuthorityState;
  readonly handoffRequired: boolean;
  readonly responseText: string;
}

export type LanguageEquivalenceMismatchCode =
  | 'FACT_SET_REF_DRIFT'
  | 'FACT_KEYSET_DRIFT'
  | 'FACT_VALUE_DRIFT'
  | 'FACT_AUTHORITY_DRIFT'
  | 'IDENTIFIER_DRIFT'
  | 'VARIANT_LABEL_DRIFT'
  | 'UNKNOWN_STATE_DRIFT'
  | 'CONFLICT_STATE_DRIFT'
  | 'POLICY_COMMITMENT_DRIFT'
  | 'CUSTOMER_VERIFICATION_DRIFT'
  | 'ACTION_AUTHORITY_DRIFT'
  | 'HANDOFF_DRIFT';

export interface LanguageEquivalenceMismatch {
  readonly code: LanguageEquivalenceMismatchCode;
  readonly detail: string;
}

export interface LanguageEquivalenceResult {
  readonly status: 'PASS' | 'FAIL';
  readonly mismatches: readonly LanguageEquivalenceMismatch[];
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function arrayEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function canonicalFacts(snapshot: CriticalResponseSnapshot): Map<string, CriticalFactAtom> {
  const result = new Map<string, CriticalFactAtom>();
  for (const fact of snapshot.facts) {
    if (result.has(fact.key)) {
      throw new Error(`Duplicate critical fact key: ${fact.key}`);
    }
    result.set(fact.key, fact);
  }
  return result;
}

/**
 * Deterministic TR/EN authority-equivalence gate.
 * Wording may differ; critical facts, identifiers, unknown/conflict state,
 * verification, policy commitments and action/handoff authority may not.
 */
export function evaluateLanguageAuthorityEquivalence(
  first: CriticalResponseSnapshot,
  second: CriticalResponseSnapshot,
): LanguageEquivalenceResult {
  const mismatches: LanguageEquivalenceMismatch[] = [];

  if (first.factSetRef !== second.factSetRef) {
    mismatches.push({ code: 'FACT_SET_REF_DRIFT', detail: `${first.factSetRef} != ${second.factSetRef}` });
  }

  const firstFacts = canonicalFacts(first);
  const secondFacts = canonicalFacts(second);
  const firstKeys = [...firstFacts.keys()].sort();
  const secondKeys = [...secondFacts.keys()].sort();

  if (!arrayEqual(firstKeys, secondKeys)) {
    mismatches.push({ code: 'FACT_KEYSET_DRIFT', detail: `${firstKeys.join(',')} != ${secondKeys.join(',')}` });
  } else {
    for (const key of firstKeys) {
      const a = firstFacts.get(key);
      const b = secondFacts.get(key);
      if (!a || !b) continue;
      if (a.value !== b.value) {
        mismatches.push({ code: 'FACT_VALUE_DRIFT', detail: `${key}: ${String(a.value)} != ${String(b.value)}` });
      }
      if (a.authorityRef !== b.authorityRef) {
        mismatches.push({ code: 'FACT_AUTHORITY_DRIFT', detail: `${key}: ${a.authorityRef} != ${b.authorityRef}` });
      }
    }
  }

  const compareSet = (
    code: LanguageEquivalenceMismatchCode,
    left: readonly string[],
    right: readonly string[],
  ): void => {
    const a = sortedUnique(left);
    const b = sortedUnique(right);
    if (!arrayEqual(a, b)) {
      mismatches.push({ code, detail: `${a.join('|')} != ${b.join('|')}` });
    }
  };

  compareSet('IDENTIFIER_DRIFT', first.exactIdentifiers, second.exactIdentifiers);
  compareSet('VARIANT_LABEL_DRIFT', first.exactVariantLabels, second.exactVariantLabels);
  compareSet('UNKNOWN_STATE_DRIFT', first.unknownRefs, second.unknownRefs);
  compareSet('CONFLICT_STATE_DRIFT', first.conflictRefs, second.conflictRefs);
  compareSet('POLICY_COMMITMENT_DRIFT', first.policyCommitmentRefs, second.policyCommitmentRefs);

  if (first.customerVerificationLevel !== second.customerVerificationLevel) {
    mismatches.push({
      code: 'CUSTOMER_VERIFICATION_DRIFT',
      detail: `${first.customerVerificationLevel} != ${second.customerVerificationLevel}`,
    });
  }

  if (first.actionAuthorityState !== second.actionAuthorityState) {
    mismatches.push({
      code: 'ACTION_AUTHORITY_DRIFT',
      detail: `${first.actionAuthorityState} != ${second.actionAuthorityState}`,
    });
  }

  if (first.handoffRequired !== second.handoffRequired) {
    mismatches.push({ code: 'HANDOFF_DRIFT', detail: `${first.handoffRequired} != ${second.handoffRequired}` });
  }

  return { status: mismatches.length === 0 ? 'PASS' : 'FAIL', mismatches };
}
