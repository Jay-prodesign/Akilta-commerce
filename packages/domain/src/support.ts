export const SUPPORT_STATES = [
  'UNKNOWN',
  'UNSUPPORTED',
  'AVAILABLE',
  'STALE',
  'ERROR',
  'BLOCKED_BY_ACCESS',
] as const;

export type SupportState = (typeof SUPPORT_STATES)[number];

export const INTEGRATION_STATUSES = [
  'UNCONFIGURED',
  'CONNECTING',
  'CONNECTED_UNVERIFIED',
  'VERIFIED',
  'DEGRADED',
  'REVOKED',
  'ERROR',
] as const;

export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

export const WORKSPACE_READINESS_STATES = [
  'NOT_STARTED',
  'IN_PROGRESS',
  'BLOCKED_BY_ACCESS',
  'READY_FOR_TEST',
  'PILOT_READY',
  'DEGRADED',
] as const;

export type WorkspaceReadinessState = (typeof WORKSPACE_READINESS_STATES)[number];
