import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeDatabase, getDatabase } from '../db/sqlite';
import { runMigrations } from '../db/migrate';
import health from './health';
import { requestLogging } from '../utils/requestLogging';

const app = express();
app.use(requestLogging);
app.use('/api/health', health);

afterEach(async () => {
  vi.restoreAllMocks();
  await closeDatabase();
});

describe('health signals', () => {
  it('reports liveness without requiring database access and emits request telemetry', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const response = await request(app).get('/api/health/live');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const entry = log.mock.calls.map(([value]) => String(value))
      .find((value) => value.includes('"event":"http_request"'));
    expect(entry).toBeDefined();
    expect(JSON.parse(entry!)).toMatchObject({
      event: 'http_request', method: 'GET', statusCode: 200,
      requestId: response.headers['x-request-id'],
    });
    expect(JSON.parse(entry!).durationMs).toBeGreaterThanOrEqual(0);
  });

  it('reports ready after migrations, including an empty database', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await getDatabase(true);
    await runMigrations(true);
    const response = await request(app).get('/api/health/ready');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ready', checks: { database: 'ok' } });
  });

  it('returns 503 and logs failure when required tables are missing', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await getDatabase(true);
    const response = await request(app).get('/api/health/ready');
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: 'not_ready', checks: { database: 'unavailable' } });
    expect(response.text).not.toContain('no such table');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('"event":"readiness_failed"'));
  });
});
