import { Router } from 'express';

import { HealthResponse } from '../schemas/health.js';

export interface HealthDeps {
  version: string;
  startedAt: number;
  /** Returns true when the database answers, false when it does not, null when no database is configured yet. */
  pingDatabase: () => Promise<boolean | null>;
}

export function healthRoutes(deps: HealthDeps): Router {
  const r = Router();
  r.get('/health', async (_req, res, next) => {
    try {
      const db = await deps.pingDatabase();
      const body: HealthResponse = {
        status: db === false ? 'degraded' : 'ok',
        version: deps.version,
        uptimeSeconds: Math.floor((Date.now() - deps.startedAt) / 1000),
        checks: { database: db === null ? 'skipped' : db ? 'ok' : 'down' },
        time: new Date().toISOString()
      };
      res.status(body.status === 'ok' ? 200 : 503).json(HealthResponse.parse(body));
    } catch (e) {
      next(e);
    }
  });
  return r;
}
