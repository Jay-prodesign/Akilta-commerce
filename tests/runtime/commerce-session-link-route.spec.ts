import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import app from '../../apps/api/src/worker';
import {
  registerCommerceSessionLinkRoutes,
  type CommerceSessionLinkExchangeRouteVariables,
} from '../../apps/api/src/commerce-session-link-route';
import {
  createCommerceSessionLinkStore,
  type CommerceSessionLinkQueryExecutor,
} from '../../apps/api/src/commerce-session-link-store';

/**
 * Real Hono/Workers-runtime HTTP round trip for the commerce session-link exchange route
 * registered in apps/api/src/worker.ts — the one thing the tests/security/commerce-session-link-
 * route.spec.ts plain-function suite cannot cover: real HTTP method/path routing, body parsing, and
 * JSON response shaping dispatched by Hono itself.
 */

function existingActiveLinkExecutor(): CommerceSessionLinkQueryExecutor {
  return {
    query: (sql, params) => {
      if (sql.includes('SELECT principal_id, external_link_ref, generation, revoked\n  FROM commerce_session_links')) {
        return Promise.resolve({
          rows: [{ principal_id: 'workers-session-principal-1', external_link_ref: 'workers-session-link-1', generation: 0, revoked: false }],
        });
      }
      if (sql.startsWith('SELECT generation, revoked')) {
        return Promise.resolve({ rows: [{ generation: 0, revoked: false }] });
      }
      const [newGeneration, newRevoked, , , expectedGeneration] = params;
      if (Number(expectedGeneration) !== 0) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [{ generation: newGeneration, revoked: newRevoked }] });
    },
  };
}

function buildTestApp(executor: CommerceSessionLinkQueryExecutor = existingActiveLinkExecutor()) {
  const testApp = new Hono<{ Variables: CommerceSessionLinkExchangeRouteVariables }>();
  testApp.use('*', async (c, next) => {
    c.set('commerceSessionLinkStore', createCommerceSessionLinkStore(executor));
    c.set('consumedFederatedExchangeNonces', new Set());
    c.set('appliedSessionLinkIdempotencyKeys', new Map());
    await next();
  });
  registerCommerceSessionLinkRoutes(testApp);
  return testApp;
}

/**
 * The real route always evaluates freshness against the actual server wall-clock time (`now` is
 * never read from the request body — accepting a client-supplied "now" would let a forged envelope
 * claim to be fresh forever). `issuedAt`/`expiresAt` are therefore computed relative to the actual
 * moment each test runs, not a fixed historical string, so they stay genuinely fresh however long
 * this suite takes to run.
 */
function exchangeBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + 10 * 60 * 1000);
  return {
    audience: 'ai-commerce',
    purpose: 'session-link-exchange',
    version: '1',
    nonce: 'workers-nonce-1',
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    authProvider: 'akilta',
    externalSubjectRef: 'akilta-subject-1',
    operation: 'RELINK',
    expectedGeneration: 0,
    idempotencyKey: 'workers-idem-1',
    ...overrides,
  };
}

describe('commerce session-link exchange HTTP route', () => {
  it('fails closed with 500 SESSION_CONTEXT_NOT_RESOLVED against the real unmodified production worker', async () => {
    const response = await app.request('https://worker.test/v1/session-links/exchange', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(exchangeBody()),
    });
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ code: 'SESSION_CONTEXT_NOT_RESOLVED' });
  });

  it('applies a real RELINK end-to-end over HTTP and returns 200 with the new generation', async () => {
    const testApp = buildTestApp();
    const response = await testApp.request('https://worker.test/v1/session-links/exchange', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(exchangeBody()),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      principalId: 'workers-session-principal-1',
      externalLinkRef: 'workers-session-link-1',
      generation: 1,
      revoked: false,
      replay: false,
    });
  });

  it('returns a real 400 over HTTP when a required field is missing', async () => {
    const testApp = buildTestApp();
    const response = await testApp.request('https://worker.test/v1/session-links/exchange', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(exchangeBody({ nonce: undefined })),
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({ error: 'INVALID_REQUEST', field: 'nonce' });
  });

  it('returns a real 401 over HTTP when the envelope purpose does not match the server-owned policy', async () => {
    const testApp = buildTestApp();
    const response = await testApp.request('https://worker.test/v1/session-links/exchange', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(exchangeBody({ purpose: 'something-else' })),
    });
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'EXCHANGE_NOT_ADMITTED', reason: 'WRONG_PURPOSE' });
  });

  it('returns a real 401 over HTTP when no candidate row matches the claimed federated identity', async () => {
    const testApp = buildTestApp({ query: () => Promise.resolve({ rows: [] }) });
    const response = await testApp.request('https://worker.test/v1/session-links/exchange', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(exchangeBody()),
    });
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'NO_ACTIVE_SESSION_LINK', reason: 'NO_MATCHING_LINK' });
  });

  it("returns a real 400 over HTTP when operation is 'LINK', which this route never accepts", async () => {
    const testApp = buildTestApp();
    const response = await testApp.request('https://worker.test/v1/session-links/exchange', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(exchangeBody({ operation: 'LINK' })),
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({ error: 'INVALID_REQUEST', field: 'operation' });
  });

  it('returns a real 409 over HTTP on a stale expectedGeneration', async () => {
    const testApp = buildTestApp();
    const response = await testApp.request('https://worker.test/v1/session-links/exchange', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(exchangeBody({ expectedGeneration: 5 })),
    });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'SESSION_LINK_CONFLICT', reason: 'STALE_EXPECTED_GENERATION' });
  });
});
