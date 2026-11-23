import {
  deriveAcquisitionLifecycleState,
  internalId,
  projectAcquisitionLifecycle,
  utcTimestamp,
  type AcquisitionAxisInputs,
  type MerchantWorkspaceId,
} from '../../packages/domain/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const workspaceId: MerchantWorkspaceId = internalId('dist-workspace-1', 'MerchantWorkspace');
const now = utcTimestamp(new Date(1000));

function axes(overrides: Partial<AcquisitionAxisInputs> = {}): AcquisitionAxisInputs {
  return {
    installAxis: 'VERIFIED',
    identityAxis: 'VERIFIED',
    entitlementAxis: 'VERIFIED',
    configurationAxis: 'VERIFIED',
    reconciliationPending: false,
    ...overrides,
  };
}

const cases: Array<{ id: string; run: () => void }> = [
  {
    id: 'DIST-PROJ-01-ALL-AXES-VERIFIED-RESOLVES-ACTIVE',
    run: () => {
      const result = deriveAcquisitionLifecycleState(axes());
      assert(result.overallState === 'ACTIVE' && result.unmetAxes.length === 0, 'all-verified axes must resolve ACTIVE with no unmet axes');
    },
  },
  {
    id: 'DIST-PROJ-02-ALL-AXES-NOT-STARTED-RESOLVES-PENDING',
    run: () => {
      const result = deriveAcquisitionLifecycleState(
        axes({ installAxis: 'NOT_STARTED', identityAxis: 'NOT_STARTED', entitlementAxis: 'NOT_STARTED', configurationAxis: 'NOT_STARTED' }),
      );
      assert(result.overallState === 'PENDING', 'an acquisition where nothing has started must resolve PENDING');
    },
  },
  {
    id: 'DIST-PROJ-03-MIXED-AXES-NEVER-RESOLVE-ACTIVE-ONLY-PARTIAL',
    run: () => {
      const result = deriveAcquisitionLifecycleState(axes({ entitlementAxis: 'PENDING' }));
      assert(
        result.overallState === 'PARTIAL' && result.unmetAxes.includes('entitlementAxis'),
        'an incomplete entitlement axis must keep the overall state PARTIAL, never ACTIVE, even with every other axis verified (DIST-05)',
      );
    },
  },
  {
    id: 'DIST-PROJ-04-ANY-BLOCKED-AXIS-FORCES-OVERALL-BLOCKED',
    run: () => {
      const result = deriveAcquisitionLifecycleState(axes({ configurationAxis: 'BLOCKED' }));
      assert(result.overallState === 'BLOCKED', 'a single blocked axis must force the overall projection to BLOCKED, never partially succeed');
    },
  },
  {
    id: 'DIST-PROJ-05-ANY-CONFLICT-AXIS-FORCES-OVERALL-CONFLICT-FAIL-CLOSED',
    run: () => {
      const result = deriveAcquisitionLifecycleState(axes({ installAxis: 'CONFLICT' }));
      assert(result.overallState === 'CONFLICT', 'a conflicting axis (e.g. simultaneous binding claims) must force CONFLICT, never pick a winner (DIST-10)');
    },
  },
  {
    id: 'DIST-PROJ-06-CONFLICT-TAKES-PRIORITY-OVER-BLOCKED-WHEN-BOTH-PRESENT',
    run: () => {
      const result = deriveAcquisitionLifecycleState(axes({ installAxis: 'CONFLICT', configurationAxis: 'BLOCKED' }));
      assert(result.overallState === 'CONFLICT', 'CONFLICT requires an explicit review decision and must take priority over an ordinary BLOCKED axis');
    },
  },
  {
    id: 'DIST-PROJ-07-RECONCILIATION-PENDING-OVERRIDES-EVEN-ALL-VERIFIED-AXES-NO-FALSE-SUCCESS',
    run: () => {
      const result = deriveAcquisitionLifecycleState(axes({ reconciliationPending: true }));
      assert(
        result.overallState === 'RECONCILIATION_REQUIRED',
        'an unreconciled duplicate/out-of-order/timed-out event must force RECONCILIATION_REQUIRED even when every axis currently reads VERIFIED -- the axis statuses cannot yet be trusted (DIST-13, no false success)',
      );
    },
  },
  {
    id: 'DIST-PROJ-08-RECONCILIATION-PENDING-TAKES-PRIORITY-OVER-CONFLICT-AND-BLOCKED',
    run: () => {
      const result = deriveAcquisitionLifecycleState(
        axes({ reconciliationPending: true, installAxis: 'CONFLICT', configurationAxis: 'BLOCKED' }),
      );
      assert(result.overallState === 'RECONCILIATION_REQUIRED', 'reconciliationPending must be checked before every axis gate, not merely among them');
    },
  },
  {
    id: 'DIST-PROJ-09-UNMET-AXES-LISTS-EXACTLY-THE-NON-VERIFIED-AXES',
    run: () => {
      const result = deriveAcquisitionLifecycleState(axes({ identityAxis: 'PENDING', configurationAxis: 'NOT_STARTED' }));
      assert(
        result.overallState === 'PARTIAL' &&
          result.unmetAxes.length === 2 &&
          result.unmetAxes.includes('identityAxis') &&
          result.unmetAxes.includes('configurationAxis'),
        'unmetAxes must name exactly the axes that are not VERIFIED, no more and no fewer',
      );
    },
  },
  {
    id: 'DIST-PROJ-10-PROJECTION-HAS-NO-ROUTE-OR-CHANNEL-INPUT-STRUCTURALLY-CANNOT-INFER-ACTIVE-FROM-ROUTE',
    run: () => {
      // deriveAcquisitionLifecycleState/projectAcquisitionLifecycle take only axis statuses and a
      // workspace id/timestamp -- there is no "route"/"channel"/"acquisitionSource" field anywhere on
      // AcquisitionAxisInputs, so two acquisitions that differ only in route but present identical axis
      // evidence MUST project identically (DIST-12: never infer live/supported status from the route).
      const shopifyRouteEvidence = axes({ entitlementAxis: 'PENDING' });
      const directRouteEvidence = axes({ entitlementAxis: 'PENDING' });
      const a = deriveAcquisitionLifecycleState(shopifyRouteEvidence);
      const b = deriveAcquisitionLifecycleState(directRouteEvidence);
      assert(
        a.overallState === b.overallState && JSON.stringify(a.unmetAxes) === JSON.stringify(b.unmetAxes),
        'identical axis evidence must project identically regardless of which acquisition route produced it',
      );
    },
  },
  {
    id: 'DIST-PROJ-11-PROJECTION-IS-A-NON-AUTHORITY-READ-ONLY-FROZEN-VIEW',
    run: () => {
      const projection = projectAcquisitionLifecycle({ merchantWorkspaceId: workspaceId, axes: axes(), computedAt: now });
      assert(Object.isFrozen(projection), 'the projection must be a frozen, read-only view, never a mutable authority record');
      assert(
        projection.merchantWorkspaceId === workspaceId && projection.overallState === 'ACTIVE' && projection.computedAt === now,
        'the projection must faithfully carry the workspace id, derived state, and computedAt it was given',
      );
      const keys = Object.keys(projection).sort();
      assert(
        !keys.includes('route') && !keys.includes('channel') && !keys.includes('acquisitionSource'),
        'the projection type must carry no route/channel field through which DIST-12 could be violated',
      );
    },
  },
];

function main() {
  for (const testCase of cases) {
    testCase.run();
    console.log(`PASS ${testCase.id}`);
  }
  console.log(`PASS ${cases.length}/${cases.length} acquisition lifecycle projection (AC-DIST-001) scenarios`);
}

main();
