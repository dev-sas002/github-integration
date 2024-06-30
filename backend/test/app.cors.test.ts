import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';

// FRONTEND_URL in test/setup.ts is http://localhost:4200, which is also the
// default CORS whitelist.
describe('CORS', () => {
  const app = createApp();

  it('allows the configured frontend origin', async () => {
    const res = await request(app).get('/').set('Origin', 'http://localhost:4200');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:4200');
  });

  it('answers an unlisted origin without CORS headers instead of failing it', async () => {
    const res = await request(app).get('/').set('Origin', 'http://web:8080');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
