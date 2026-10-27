import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

export const requestLogging: RequestHandler = (req, res, next) => {
  const started = process.hrtime.bigint();
  const requestId = randomUUID();
  res.set('X-Request-ID', requestId);
  res.on('finish', () => {
    console.log(JSON.stringify({
      event: 'http_request',
      requestId,
      method: req.method,
      statusCode: res.statusCode,
      durationMs: Number(process.hrtime.bigint() - started) / 1e6,
    }));
  });
  next();
};
