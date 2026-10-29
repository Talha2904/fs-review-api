import pino from 'pino';
import { pinoHttp } from 'pino-http';

import type { Logger } from '../../application/ports/Logger.js';

export function createLogger(level: string, pretty: boolean): Logger {
  const base = pino({
    level,
    redact: { paths: ['req.headers.cookie', 'req.headers.authorization', '*.password', '*.token'], censor: '[redacted]' },
    ...(pretty ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } } : {})
  });
  return base as unknown as Logger;
}

/** Express middleware that logs one line per request with the request id. */
export function createHttpLogger(logger: Logger) {
  return pinoHttp({
    logger: logger as unknown as pino.Logger,
    genReqId: (req) => (req.headers['x-request-id'] as string | undefined) ?? '',
    customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
    serializers: { req: (r) => ({ id: r.id, method: r.method, url: r.url }), res: (r) => ({ statusCode: r.statusCode }) }
  });
}
