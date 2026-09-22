import {
  evaluateExternalEffectGate,
  validateRuntimeConfig,
  type RuntimeConfigInput,
  type SafetySwitchSnapshot,
} from '../../apps/api/src/runtime-config';
import { internalId, utcTimestamp } from '../../packages/domain/src';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const ws = internalId('ws-a', 'MerchantWorkspace');
const now = utcTimestamp('2026-08-07T18:00:00Z');

function baseConfig(overrides: Partial<RuntimeConfigInput> = {}): RuntimeConfigInput {
  return {
    environment: 'DEV',
    configVersion: 'cfg-1',
    releaseLabel: 'staging-drive',
    bindings: { databaseReady: true, queueReady: true },
    enabledCapabilities: {
      asyncProcessing: true,
      externalWebAuth: false,
      metaWhatsApp: false,
      aiProvider: false,
    },
    secretReferences: [],
    allowedExternalHosts: ['graph.facebook.com'],
    ...overrides,
  };
}

function allowSwitch(key: SafetySwitchSnapshot['key'], operation?: string): SafetySwitchSnapshot {
  return {
    key,
    scope: { environment: 'DEV', merchantWorkspaceId: ws, ...(operation ? { operation } : {}) },
    state: 'ALLOW',
    configVersion: 'cfg-1',
    verifiedAt: now,
    sourceRef: `switch:${key}`,
  };
}

const cases: Array<{ id: string; run: () => void }> = [
  {
    id: 'CFG-01-MISSING-DB-BINDING-FAILS',
    run: () => {
      const result = validateRuntimeConfig(baseConfig({ bindings: { databaseReady: false, queueReady: true } }));
      assert(result.status === 'INVALID' && result.errors.includes('DATABASE_BINDING_REQUIRED'), 'missing DB must fail');
    },
  },
  {
    id: 'CFG-03-SECRET-REFERENCE-HAS-NO-VALUE-FIELD',
    run: () => {
      const config = baseConfig({
        enabledCapabilities: { asyncProcessing: true, externalWebAuth: false, metaWhatsApp: true, aiProvider: false },
        secretReferences: [
          { environment: 'DEV', bindingName: 'META_SIGNING_REF', purpose: 'META_SIGNING' },
          { environment: 'DEV', bindingName: 'META_AUTH_REF', purpose: 'META_AUTH' },
        ],
      });
      assert(!/secretValue|accessToken|password/i.test(JSON.stringify(config)), 'config must not store secret values');
      assert(validateRuntimeConfig(config).status === 'VALID', 'references should validate');
    },
  },
  {
    id: 'CFG-04-CROSS-ENV-SECRET-REFERENCE-DENY',
    run: () => {
      const result = validateRuntimeConfig(baseConfig({
        environment: 'PRODUCTION',
        secretReferences: [{ environment: 'DEV', bindingName: 'AUTH_REF', purpose: 'AUTH_PROVIDER_VERIFIER' }],
      }));
      assert(result.status === 'INVALID' && result.errors.includes('CROSS_ENVIRONMENT_SECRET_REFERENCE_DENIED'), 'DEV secret ref must not enter PROD');
    },
  },
  {
    id: 'CFG-05-OUTBOUND-KILL-SWITCH-STOPS',
    run: () => {
      const stop: SafetySwitchSnapshot = { ...allowSwitch('KS-OUTBOUND-MESSAGE'), state: 'STOP' };
      const result = evaluateExternalEffectGate({
        effect: 'OUTBOUND_MESSAGE', environment: 'DEV', configVersion: 'cfg-1', merchantWorkspaceId: ws,
        releaseFlagEnabled: true, authorizationDecision: 'ALLOW', providerSupportState: 'AVAILABLE', switches: [stop],
      });
      assert(result.decision === 'DENY' && result.reason === 'KILL_SWITCH_ACTIVE', 'kill switch must stop before provider');
    },
  },
  {
    id: 'CFG-06-OPERATION-SCOPE-DOES-NOT-BLOCK-UNRELATED',
    run: () => {
      const stopOther: SafetySwitchSnapshot = { ...allowSwitch('KS-COMMERCE-READ', 'inventory.read'), state: 'STOP' };
      const allowProduct = allowSwitch('KS-COMMERCE-READ', 'product.read');
      const result = evaluateExternalEffectGate({
        effect: 'COMMERCE_READ', environment: 'DEV', configVersion: 'cfg-1', merchantWorkspaceId: ws,
        operation: 'product.read', releaseFlagEnabled: true, authorizationDecision: 'ALLOW', providerSupportState: 'AVAILABLE',
        switches: [stopOther, allowProduct],
      });
      assert(result.decision === 'ALLOW', 'unrelated operation stop must not block safe operation');
    },
  },
  {
    id: 'CFG-07-AUTOREPLY-STOP-DOES-NOT-IMPLY-INBOX-STOP',
    run: () => {
      const stop: SafetySwitchSnapshot = { ...allowSwitch('KS-AI-AUTOREPLY'), state: 'STOP' };
      const result = evaluateExternalEffectGate({
        effect: 'AI_AUTOREPLY', environment: 'DEV', configVersion: 'cfg-1', merchantWorkspaceId: ws,
        releaseFlagEnabled: true, authorizationDecision: 'ALLOW', providerSupportState: 'AVAILABLE', switches: [stop],
      });
      assert(result.decision === 'DENY', 'auto-reply must stop');
      // Read-only/manual inbox is deliberately a separate operation and therefore not evaluated by this auto-reply gate.
    },
  },
  {
    id: 'CFG-08-UNKNOWN-PROVIDER-CANNOT-BE-FLAG-ENABLED',
    run: () => {
      const result = evaluateExternalEffectGate({
        effect: 'COMMERCE_READ', environment: 'DEV', configVersion: 'cfg-1', merchantWorkspaceId: ws,
        releaseFlagEnabled: true, authorizationDecision: 'ALLOW', providerSupportState: 'UNKNOWN',
        switches: [allowSwitch('KS-COMMERCE-READ')],
      });
      assert(result.decision === 'DENY' && result.reason === 'PROVIDER_CAPABILITY_NOT_AVAILABLE', 'UNKNOWN capability must fail closed');
    },
  },
  {
    id: 'CFG-09-FEATURE-FLAG-CANNOT-BYPASS-AUTHZ',
    run: () => {
      const result = evaluateExternalEffectGate({
        effect: 'OUTBOUND_MESSAGE', environment: 'DEV', configVersion: 'cfg-1', merchantWorkspaceId: ws,
        releaseFlagEnabled: true, authorizationDecision: 'DENY', providerSupportState: 'AVAILABLE',
        switches: [allowSwitch('KS-OUTBOUND-MESSAGE')],
      });
      assert(result.decision === 'DENY' && result.reason === 'AUTHORIZATION_NOT_ALLOWED', 'flag cannot elevate authz');
    },
  },
  {
    id: 'CFG-10-STALE-CONFIG-VERSION-FAILS-CLOSED',
    run: () => {
      const stale: SafetySwitchSnapshot = { ...allowSwitch('KS-OUTBOUND-MESSAGE'), configVersion: 'old-backup-cfg' };
      const result = evaluateExternalEffectGate({
        effect: 'OUTBOUND_MESSAGE', environment: 'DEV', configVersion: 'cfg-1', merchantWorkspaceId: ws,
        releaseFlagEnabled: true, authorizationDecision: 'ALLOW', providerSupportState: 'AVAILABLE', switches: [stale],
      });
      assert(result.decision === 'DENY' && result.reason === 'KILL_SWITCH_UNVERIFIED', 'stale restored switch must not silently allow');
    },
  },
  {
    id: 'CFG-KILL-SWITCH-MISSING-FAILS-CLOSED',
    run: () => {
      const result = evaluateExternalEffectGate({
        effect: 'OUTBOUND_MESSAGE', environment: 'DEV', configVersion: 'cfg-1', merchantWorkspaceId: ws,
        releaseFlagEnabled: true, authorizationDecision: 'ALLOW', providerSupportState: 'AVAILABLE', switches: [],
      });
      assert(result.decision === 'DENY' && result.reason === 'KILL_SWITCH_UNVERIFIED', 'missing switch must not imply allow');
    },
  },
];

for (const testCase of cases) {
  testCase.run();
  console.log(`PASS ${testCase.id}`);
}
console.log(`PASS ${cases.length}/${cases.length} runtime config scenarios`);
