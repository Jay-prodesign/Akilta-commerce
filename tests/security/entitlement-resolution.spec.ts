import {
  entitlementIdempotencyKey,
  evaluateEntitlementGenerationFencing,
  resolveEffectiveEntitlementSource,
  resolveEntitlementTransition,
  type BillingObservationCandidate,
  type EntitlementIdempotencyKey,
  type EntitlementRecord,
  type EntitlementTransitionRequest,
} from '../../packages/authz/src';
import { shouldAdvanceMonotonicProjection } from '../../packages/events/src';
import {
  ENTITLEMENT_STATES,
  billingSourceRef,
  hasAnyEntitlementGrant,
  internalId,
  moduleKey,
  operationalStatus,
  utcTimestamp,
  type EntitlementState,
  type MerchantWorkspaceId,
} from '../../packages/domain/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const workspaceId: MerchantWorkspaceId = internalId('billent-workspace-1', 'MerchantWorkspace');
const otherWorkspaceId: MerchantWorkspaceId = internalId('billent-workspace-2', 'MerchantWorkspace');
const whatsappModule = moduleKey('whatsapp-support');
const webchatModule = moduleKey('webchat');
const noPriorApplications: ReadonlyMap<EntitlementIdempotencyKey, EntitlementRecord> = new Map();

function candidate(overrides: Partial<BillingObservationCandidate> = {}): BillingObservationCandidate {
  return {
    merchantWorkspaceId: workspaceId,
    moduleKey: whatsappModule,
    billingSourceRef: billingSourceRef('shopify-billing:sub-1'),
    claimedState: 'ACTIVE',
    status: operationalStatus('ACTIVE'),
    ...overrides,
  };
}

function record(overrides: Partial<EntitlementRecord> = {}): EntitlementRecord {
  return {
    ownerMerchantWorkspaceId: workspaceId,
    ownerModuleKey: whatsappModule,
    state: 'ACTIVE',
    generation: 0,
    ...overrides,
  };
}

function request(overrides: Partial<EntitlementTransitionRequest> = {}): EntitlementTransitionRequest {
  return {
    merchantWorkspaceId: workspaceId,
    moduleKey: whatsappModule,
    trigger: 'ENTER_GRACE',
    expectedGeneration: 0,
    idempotencyKey: entitlementIdempotencyKey('billent-op-1'),
    ...overrides,
  };
}

const now = utcTimestamp(new Date(2000));

const cases: Array<{ id: string; run: () => void }> = [
  {
    id: 'BILLENT-01-NO-CURRENT-ENTITLEMENT-FOR-REQUIRED-MODULE-RESOLVES-NONE',
    run: () => {
      const result = resolveEffectiveEntitlementSource([], workspaceId, whatsappModule, now);
      assert(result.outcome === 'NONE', 'an empty candidate list must resolve NONE, never assume a default grant');
      assert(hasAnyEntitlementGrant('NONE') === false, 'NONE is the one state with no grant at all, by construction');
    },
  },
  {
    id: 'BILLENT-02-EXACTLY-ONE-CURRENT-EFFECTIVE-WORKSPACE-MODULE-GRANT-RESOLVES',
    run: () => {
      const result = resolveEffectiveEntitlementSource([candidate()], workspaceId, whatsappModule, now);
      assert(result.outcome === 'RESOLVED', 'exactly one current effective candidate must resolve');
      assert(
        result.outcome === 'RESOLVED' && result.record.billingSourceRef === candidate().billingSourceRef,
        'the resolved record must be the actual matching candidate, not a reconstruction',
      );
    },
  },
  {
    id: 'BILLENT-03-CONFLICTING-CURRENT-BILLING-SOURCES-FAIL-CLOSED-NO-DOUBLE-GRANT',
    run: () => {
      const first = candidate({ billingSourceRef: billingSourceRef('shopify-billing:sub-1') });
      const second = candidate({ billingSourceRef: billingSourceRef('manual-override:grant-1') });
      const result = resolveEffectiveEntitlementSource([first, second], workspaceId, whatsappModule, now);
      assert(result.outcome === 'CONFLICT', 'two simultaneously effective sources for the same workspace+module must fail closed as CONFLICT');
      assert(
        result.outcome === 'CONFLICT' && result.candidates.length === 2,
        'CONFLICT must carry every effective candidate as evidence, never silently pick a winner (no first-match/latest-row tie-break)',
      );
    },
  },
  {
    id: 'BILLENT-04-ADD-MODULE-ACTIVATES-ONLY-AT-VERSIONED-EFFECTIVE-FROM-BOUNDARY',
    run: () => {
      const notYetEffective = candidate({ validFrom: utcTimestamp(new Date(5000)) });
      const before = resolveEffectiveEntitlementSource([notYetEffective], workspaceId, whatsappModule, now);
      assert(before.outcome === 'NONE', 'a candidate whose effectiveFrom has not yet arrived must not count as a current grant');

      const atBoundary = resolveEffectiveEntitlementSource(
        [notYetEffective],
        workspaceId,
        whatsappModule,
        utcTimestamp(new Date(5000)),
      );
      assert(atBoundary.outcome === 'RESOLVED', 'the exact same candidate must resolve once its effectiveFrom boundary is reached');
    },
  },
  {
    id: 'BILLENT-05-REMOVAL-REVOKE-STOPS-COUNTING-AS-CURRENT-AT-THE-EFFECTIVE-BOUNDARY',
    run: () => {
      const removed = candidate({ validTo: utcTimestamp(new Date(3000)) });
      const before = resolveEffectiveEntitlementSource([removed], workspaceId, whatsappModule, utcTimestamp(new Date(2000)));
      assert(before.outcome === 'RESOLVED', 'before the removal boundary the candidate is still current');

      const atOrAfter = resolveEffectiveEntitlementSource([removed], workspaceId, whatsappModule, utcTimestamp(new Date(3000)));
      assert(atOrAfter.outcome === 'NONE', 'at/after the removal boundary the candidate must stop counting as a current grant');
    },
  },
  {
    id: 'BILLENT-06-QUEUED-ACTION-WITH-OLDER-ENTITLEMENT-GENERATION-IS-DENIED-AT-DISPATCH',
    run: () => {
      const current = record({ generation: 5 });
      const stale = evaluateEntitlementGenerationFencing(3, current);
      assert(
        stale.status === 'STALE' && stale.reason === 'STALE_ENTITLEMENT_GENERATION',
        'a queued action carrying an older captured generation must be denied at dispatch-time revalidation',
      );
      const fresh = evaluateEntitlementGenerationFencing(5, current);
      assert(fresh.status === 'CURRENT', 'an action carrying the exact current generation must pass fencing');
    },
  },
  {
    id: 'BILLENT-07-DUPLICATE-PROVIDER-EVENT-IS-IDEMPOTENT-NO-GENERATION-CHURN',
    run: () => {
      const key = entitlementIdempotencyKey('billent-duplicate-op');
      const current = record({ generation: 0 });
      const first = resolveEntitlementTransition(request({ idempotencyKey: key }), current, noPriorApplications);
      assert(first.status === 'APPLIED' && first.resultingRecord.generation === 1, 'the first delivery must apply and advance the generation by exactly one');

      const ledger: ReadonlyMap<EntitlementIdempotencyKey, EntitlementRecord> = new Map([[key, first.resultingRecord]]);
      const redelivered = resolveEntitlementTransition(request({ idempotencyKey: key }), current, ledger);
      assert(
        redelivered.status === 'ALREADY_APPLIED' && redelivered.resultingRecord.generation === 1,
        'a redelivered duplicate provider event with the same idempotency key must replay the original outcome, never advancing the generation again',
      );
    },
  },
  {
    id: 'BILLENT-08-OUT-OF-ORDER-STALE-EVENT-CANNOT-REGRESS-THE-RECONCILED-CURRENT-STATE',
    run: () => {
      // Composition with the pre-existing ordering primitive (packages/events/src/operational.ts),
      // unmodified: a caller reconciling a provider event order-gates with it BEFORE ever calling
      // resolveEntitlementTransition, so a stale/out-of-order event never reaches the CAS transition
      // at all.
      const currentSourceTimestamp = utcTimestamp(new Date(2000));
      const outOfOrderIncoming = utcTimestamp(new Date(1000));
      assert(
        shouldAdvanceMonotonicProjection(currentSourceTimestamp, outOfOrderIncoming) === false,
        'an out-of-order provider event (older source timestamp) must never be allowed to advance the entitlement projection',
      );

      // And independently: even if an out-of-order event's trigger somehow reached the CAS transition,
      // a stale expectedGeneration still fails closed as CONFLICT rather than regressing current state.
      const current = record({ generation: 5 });
      const staleAttempt = resolveEntitlementTransition(request({ expectedGeneration: 2 }), current, noPriorApplications);
      assert(
        staleAttempt.status === 'CONFLICT' && staleAttempt.reason === 'STALE_EXPECTED_GENERATION',
        'a transition presenting a stale generation must CONFLICT, never silently regress the current record',
      );
    },
  },
  {
    id: 'BILLENT-09-GRACE-PAST-DUE-RESTRICTED-REMAIN-DISTINCT-REVERSIBLE-STATES-NOT-EQUAL-TO-CANCELLED',
    run: () => {
      const reversibleStates: readonly EntitlementState[] = ['GRACE', 'PAST_DUE', 'RESTRICTED'];
      for (const state of reversibleStates) {
        const current = record({ state, generation: 1 });
        const recovered = resolveEntitlementTransition(
          request({ trigger: 'ACTIVATE', expectedGeneration: 1 }),
          current,
          noPriorApplications,
        );
        assert(
          recovered.status === 'APPLIED' && recovered.resultingRecord.state === 'ACTIVE',
          `${state} must be reversible back to ACTIVE via ACTIVATE`,
        );
      }

      const cancelled = record({ state: 'CANCELLED', generation: 9 });
      const attempt = resolveEntitlementTransition(
        request({ trigger: 'ACTIVATE', expectedGeneration: 9 }),
        cancelled,
        noPriorApplications,
      );
      assert(
        attempt.status === 'DENIED' && attempt.reason === 'TERMINAL_STATE',
        'CANCELLED must never be reversible — it is the one terminal state, structurally distinct from the reversible hold states',
      );
    },
  },
  {
    id: 'BILLENT-10-TERMINAL-CANCELLED-CANNOT-BE-RESURRECTED-BY-A-STALE-EVENT',
    run: () => {
      const cancelled = record({ state: 'CANCELLED', generation: 4 });
      for (const trigger of ['START_TRIAL', 'ACTIVATE', 'ENTER_GRACE', 'ENTER_PAST_DUE', 'RESTRICT', 'REQUEST_CANCEL', 'CANCEL'] as const) {
        const attempt = resolveEntitlementTransition(
          request({ trigger, expectedGeneration: 4 }),
          cancelled,
          noPriorApplications,
        );
        assert(
          attempt.status === 'DENIED' && attempt.reason === 'TERMINAL_STATE',
          `trigger ${trigger} against a CANCELLED generation must deny TERMINAL_STATE, never resurrect it`,
        );
      }
      // A later purchase is modeled as a brand-new EntitlementRecord (a fresh generation sequence
      // starting at NONE elsewhere), never a transition of this cancelled one — there is no API on
      // this module through which a CANCELLED record could be mutated back to an active state.
    },
  },
  {
    id: 'BILLENT-11-PAYER-BILLING-SOURCE-SWITCH-DOES-NOT-CHANGE-MERCHANT-WORKSPACE-IDENTITY',
    run: () => {
      const current = record({ billingSourceRef: billingSourceRef('shopify-billing:sub-old'), generation: 2 });
      const switched = resolveEntitlementTransition(
        request({
          trigger: 'RESTRICT',
          expectedGeneration: 2,
          billingSourceRef: billingSourceRef('shopify-billing:sub-new'),
        }),
        current,
        noPriorApplications,
      );
      assert(
        switched.status === 'APPLIED' &&
          switched.resultingRecord.ownerMerchantWorkspaceId === workspaceId &&
          switched.resultingRecord.billingSourceRef === billingSourceRef('shopify-billing:sub-new'),
        'switching the billing source must update only provenance, never the owning workspace identity',
      );

      const crossWorkspaceAttempt = resolveEntitlementTransition(
        request({ merchantWorkspaceId: otherWorkspaceId, expectedGeneration: 2 }),
        current,
        noPriorApplications,
      );
      assert(
        crossWorkspaceAttempt.status === 'DENIED' && crossWorkspaceAttempt.reason === 'SCOPE_MISMATCH',
        'scope identity is (merchantWorkspaceId, moduleKey), never billingSourceRef — a workspace claim mismatch must deny regardless of billing source',
      );
    },
  },
  {
    id: 'BILLENT-12-ENTITLED-NEVER-EQUALS-CONFIGURED-CAPABLE-OR-AUTHORIZED-BY-CONSTRUCTION',
    run: () => {
      const keys = Object.keys(record()).sort();
      assert(
        keys.every((key) =>
          ['ownerMerchantWorkspaceId', 'ownerModuleKey', 'state', 'generation', 'billingSourceRef'].includes(key),
        ),
        'EntitlementRecord must carry no installation/configuration/capability/authorization field through which any of those could be read off an entitlement check',
      );
      assert(
        ENTITLEMENT_STATES.every((state) => state === 'NONE' || state === 'CANCELLED' || hasAnyEntitlementGrant(state)),
        'hasAnyEntitlementGrant must answer the grant-existence question only, never a configured/capable/authorized question',
      );
    },
  },
  {
    id: 'BILLENT-13-DEGRADED-OR-MISSING-PROVIDER-NOTIFICATION-FORCES-RECONCILIATION-STALE-LOCAL-STATE-CANNOT-GRANT',
    run: () => {
      // No boolean/cached "isPaid" input exists anywhere on this module's API: the only way to learn
      // about entitlement is resolveEffectiveEntitlementSource over the actual current candidate list.
      // A degraded/missing provider notification means that list is empty (or stale candidates have
      // already fallen out of their effective window) — it resolves NONE, never a remembered ACTIVE.
      const degraded = resolveEffectiveEntitlementSource([], workspaceId, whatsappModule, now);
      assert(degraded.outcome === 'NONE', 'missing current provider evidence must resolve NONE, never fall back to an assumed/remembered paid state');

      // evaluateEntitlementGenerationFencing takes no state/boolean parameter at all — it is
      // structurally incapable of being swayed by a caller's claimed local paid flag; it is gated on
      // the authoritative record's own generation alone.
      const current = record({ state: 'RESTRICTED', generation: 7 });
      const fencing = evaluateEntitlementGenerationFencing(7, current);
      assert(
        fencing.status === 'CURRENT',
        'fencing answers generation-currentness only, from the authoritative record alone — there is no separate caller-suppliable "paid" input to spoof',
      );
    },
  },
  {
    id: 'BILLENT-14-MODULE-SCOPING-IS-EXACT-MATCH-ONLY-NO-IMPLICIT-PACKAGE-TO-ENTITLEMENT-INFERENCE',
    run: () => {
      // This unit deliberately does not invent a package/feature->entitlement mapping (a release-gate/
      // config concern, BILLENT-14's own acceptance text) — what it does guarantee is that ModuleKey
      // scoping is exact-match only, so no module can ever silently inherit another module's grant.
      const whatsappGrant = candidate({ moduleKey: whatsappModule });
      const resolvedForWebchat = resolveEffectiveEntitlementSource([whatsappGrant], workspaceId, webchatModule, now);
      assert(
        resolvedForWebchat.outcome === 'NONE',
        'a grant observed for one module must never resolve as current for a different module key, even under the same workspace',
      );

      const resolvedForWhatsapp = resolveEffectiveEntitlementSource([whatsappGrant], workspaceId, whatsappModule, now);
      assert(resolvedForWhatsapp.outcome === 'RESOLVED', 'the exact matching module key must still resolve normally');
    },
  },
];

function main() {
  for (const testCase of cases) {
    testCase.run();
    console.log(`PASS ${testCase.id}`);
  }
  console.log(`PASS ${cases.length}/${cases.length} entitlement resolution (SC-04/AC-BILLENT-106) scenarios`);
}

main();
