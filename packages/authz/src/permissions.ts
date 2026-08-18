import { DomainPrimitiveError } from '../../domain/src/brand';

export const PERMISSIONS = [
  'organization:read',
  'organization:manage',
  'merchant:read',
  'merchant:manage',
  'team:read',
  'team:manage',
  'integration:read',
  'integration:connect',
  'integration:disconnect',
  'integration:manage_credentials_reference',
  'conversation:read',
  'conversation:respond',
  'conversation:assign',
  'conversation:export',
  'customer:read',
  'customer:export',
  'customer:delete_request',
  'commerce.product:read',
  'commerce.inventory:read',
  'commerce.inventory:write',
  'commerce.order:read',
  'commerce.order:cancel',
  'commerce.order:refund',
  'commerce.order:update',
  'knowledge:read',
  'knowledge:write',
  'knowledge:approve',
  'merchant_rule:read',
  'merchant_rule:create',
  'merchant_rule:edit',
  'merchant_rule:approve',
  'merchant_rule:activate',
  'merchant_rule:rollback',
  'campaign:read',
  'campaign:draft',
  'campaign:send',
  'campaign:manage',
  'consent:read',
  'consent:manage',
  'analytics:read',
  'analytics:export',
  'approval:request',
  'approval:approve',
  'security:audit_read',
  'security:manage',
  'future.social:read',
  'future.social:draft',
  'future.social:publish',
  'future.meta_ads:read',
  'future.meta_ads:draft',
  'future.meta_ads:publish',
  'future.meta_ads:budget_change',
  'future.google_ads:read',
  'future.google_ads:draft',
  'future.google_ads:publish',
  'future.google_ads:budget_change',
] as const;

export type Permission = (typeof PERMISSIONS)[number];
const permissionSet: ReadonlySet<string> = new Set(PERMISSIONS);

function isPermission(value: string): value is Permission {
  return permissionSet.has(value);
}

export function permission(value: string): Permission {
  if (!isPermission(value)) {
    throw new DomainPrimitiveError(`Unknown permission: ${value}`);
  }
  return value;
}
