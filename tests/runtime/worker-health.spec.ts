import { describe, expect, it } from 'vitest';
import app from '../../apps/api/src/worker';

describe('Cloudflare Worker HTTP baseline', () => {
  it('returns a bounded health response', async () => {
    const response = await app.request('https://worker.test/health');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      service: 'ai-commerce-api',
    });
  });
});
