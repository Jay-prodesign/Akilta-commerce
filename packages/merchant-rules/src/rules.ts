import type {
  MerchantRuleId,
  MerchantRuleVersionId,
  MerchantWorkspaceId,
  UtcTimestamp,
} from '../../domain/src';

export const RULE_AUTHORITY_CLASSES = [
  'PLATFORM_HARD_CONSTRAINT',
  'MERCHANT_APPROVED_POLICY',
  'MERCHANT_RULE',
  'BRAND_TONE',
  'SESSION_PREFERENCE',
  'HISTORICAL_CANDIDATE',
] as const;
export type RuleAuthorityClass = (typeof RULE_AUTHORITY_CLASSES)[number];

const authorityRank = new Map<RuleAuthorityClass, number>(
  RULE_AUTHORITY_CLASSES.map((authority, index) => [authority, index]),
);

export interface MerchantRule {
  readonly merchantRuleId: MerchantRuleId;
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly scopeKey: string;
  readonly intent: string;
  readonly status: string;
}

export interface MerchantRuleVersion {
  readonly merchantRuleVersionId: MerchantRuleVersionId;
  readonly merchantRuleId: MerchantRuleId;
  readonly merchantWorkspaceId: MerchantWorkspaceId;
  readonly version: number;
  readonly scopeKey: string;
  readonly intent: string;
  readonly effectKey: string;
  readonly effectValue: string;
  readonly authorityClass: RuleAuthorityClass;
  readonly approvalState: 'CANDIDATE' | 'APPROVED' | 'REJECTED';
  readonly lifecycleState: 'INACTIVE' | 'ACTIVE' | 'DISABLED' | 'SUPERSEDED';
  readonly riskClass: 'R0' | 'R1' | 'R2' | 'R3' | 'R4' | 'R5';
  readonly sourceRef: string;
  readonly effectiveFrom?: UtcTimestamp;
  readonly effectiveTo?: UtcTimestamp;
  readonly supersedesVersionId?: MerchantRuleVersionId;
  readonly rollbackTargetVersionId?: MerchantRuleVersionId;
  readonly createdAt: UtcTimestamp;
}

export type RuleResolution =
  | {
      readonly state: 'RESOLVED';
      readonly winner: MerchantRuleVersion;
      readonly shadowedVersionIds: readonly MerchantRuleVersionId[];
    }
  | {
      readonly state: 'DIRECT_CONFLICT_REQUIRES_REVIEW';
      readonly competingVersionIds: readonly MerchantRuleVersionId[];
    }
  | { readonly state: 'NO_ACTIVE_RULE' };

export function resolveRuleGroup(versions: readonly MerchantRuleVersion[]): RuleResolution {
  const eligible = versions.filter(
    (version) =>
      version.approvalState === 'APPROVED' &&
      version.lifecycleState === 'ACTIVE' &&
      version.authorityClass !== 'HISTORICAL_CANDIDATE',
  );
  if (!eligible.length) return { state: 'NO_ACTIVE_RULE' };

  const minimumRank = Math.min(...eligible.map((version) => authorityRank.get(version.authorityClass) ?? 999));
  const top = eligible.filter((version) => authorityRank.get(version.authorityClass) === minimumRank);

  const latestPerRule = [...new Map(
    top
      .sort((a, b) => b.version - a.version)
      .map((version) => [version.merchantRuleId, version] as const),
  ).values()];

  const distinctValues = [...new Set(latestPerRule.map((version) => version.effectValue))];
  if (distinctValues.length > 1) {
    return {
      state: 'DIRECT_CONFLICT_REQUIRES_REVIEW',
      competingVersionIds: latestPerRule.map((version) => version.merchantRuleVersionId),
    };
  }

  const winner = latestPerRule.sort((a, b) => b.version - a.version)[0];
  if (!winner) return { state: 'NO_ACTIVE_RULE' };
  return {
    state: 'RESOLVED',
    winner,
    shadowedVersionIds: eligible
      .filter((version) => version.merchantRuleVersionId !== winner.merchantRuleVersionId)
      .map((version) => version.merchantRuleVersionId),
  };
}

export interface RulePointerChange {
  readonly merchantRuleId: MerchantRuleId;
  readonly fromVersionId: MerchantRuleVersionId;
  readonly toVersionId: MerchantRuleVersionId;
  readonly reason: 'ROLLBACK';
  readonly occurredAt: UtcTimestamp;
}

export function planRuleRollback(input: Omit<RulePointerChange, 'reason'>): RulePointerChange {
  return Object.freeze({ ...input, reason: 'ROLLBACK' as const });
}
