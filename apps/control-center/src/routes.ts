export const CONTROL_CENTER_ROUTES = [
  '/onboarding',
  '/inbox',
  '/conversations/:id',
  '/rules',
  '/approvals',
  '/integrations',
  '/audit',
  '/usage',
] as const;

export type ControlCenterRoute = (typeof CONTROL_CENTER_ROUTES)[number];
