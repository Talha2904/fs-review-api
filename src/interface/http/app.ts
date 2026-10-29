// Express app factory. No listen() here, so tests can mount it with supertest.
// Receives use cases and adapters from container.ts; never imports infrastructure itself.
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';

import type { UseCases } from '../../application/UseCases.js';
import type { EventBus } from '../../application/ports/EventBus.js';
import type { Logger } from '../../application/ports/Logger.js';
import type { PermissionRepository } from '../../application/ports/PermissionRepository.js';
import { unauthenticated } from '../../domain/errors.js';

import { attachActor } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { requestId } from './middleware/requestId.js';
import { rateLimit, sameOriginWrites } from './middleware/security.js';
import { buildOpenApi } from './openapi.js';
import { activityRoutes } from './routes/activity.js';
import { aiRoutes } from './routes/ai.js';
import { authRoutes } from './routes/auth.js';
import { billingRoutes } from './routes/billing.js';
import { configRoutes } from './routes/config.js';
import { documentRoutes } from './routes/documents.js';
import { eventRoutes } from './routes/events.js';
import { healthRoutes, type HealthDeps } from './routes/health.js';
import { pointRoutes } from './routes/points.js';
import { portfolioRoutes } from './routes/portfolio.js';
import { reviewRoutes } from './routes/review.js';
import { userRoutes } from './routes/users.js';

export interface AppDeps {
  logger: Logger;
  httpLogger: express.RequestHandler;
  corsOrigins: string[];
  version: string;
  secureCookies: boolean;
  health: Omit<HealthDeps, 'version'>;
  uc: UseCases;
  permissions: PermissionRepository;
  events: EventBus;
  /** Express trust proxy: 'loopback', a hop count, or addresses of the proxies in front of the api. */
  trustProxy?: string | number;
  /** Serve /api/docs to anyone; otherwise only outside production. */
  docsPublic?: boolean;
  /** Requests per minute per address on sign-in, set-up and password reset. */
  authRateLimit?: number;
}

// Bodies larger than the 1 MB default, accepted only from a signed-in user on these routes.
const LARGE_BODIES: Record<string, string> = { '/api/ocr': '40mb', '/api/billing/email': '25mb' };

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', deps.trustProxy ?? 'loopback');

  app.use(requestId);
  app.use(deps.httpLogger);
  // The api serves JSON, and Swagger UI outside production, which needs inline scripts. The web app's host sends
  // the web app's Content-Security-Policy (docs/OPERATIONS.md, section 4).
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: deps.corsOrigins, credentials: true, exposedHeaders: ['X-Request-Id'] }));
  app.use('/api', sameOriginWrites(deps.corsOrigins));
  // JSON bodies are small; documents, evidence and reports are multipart. OCR pages and invoice PDFs are parsed
  // further down, once the session is known.
  const small = express.json({ limit: '1mb' });
  app.use((req, res, next) => (LARGE_BODIES[req.path] ? next() : small(req, res, next)));

  if (deps.docsPublic) {
    const openapi = buildOpenApi(deps.version);
    app.get('/api/docs/openapi.json', (_req, res) => res.json(openapi));
    app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: 'FS Review API' }));
  }

  app.use('/api', healthRoutes({ ...deps.health, version: deps.version }));
  app.use(
    ['/api/auth/login', '/api/auth/setup', '/api/auth/forgot', '/api/auth/reset'],
    rateLimit({ windowMs: 60_000, max: deps.authRateLimit ?? 30 })
  );
  app.use('/api', attachActor(deps.uc.resolveSession, deps.permissions));
  for (const [path, limit] of Object.entries(LARGE_BODIES)) {
    const large = express.json({ limit });
    app.use(path, (req, res, next) => (req.actor ? large(req, res, next) : next(unauthenticated())));
  }
  app.use('/api', authRoutes({ uc: deps.uc, secureCookies: deps.secureCookies }));
  app.use('/api', userRoutes(deps.uc));
  app.use('/api', activityRoutes(deps.uc));
  app.use('/api', aiRoutes(deps.uc));
  app.use('/api', billingRoutes(deps.uc));
  app.use('/api', reviewRoutes(deps.uc));
  app.use('/api', configRoutes(deps.uc));
  app.use('/api', documentRoutes(deps.uc));
  app.use('/api', pointRoutes(deps.uc));
  app.use('/api', portfolioRoutes(deps.uc));
  app.use(
    '/api',
    eventRoutes(deps.events, async (token) => !!(await deps.uc.resolveSession.execute(token)))
  );

  app.use('/api', notFoundHandler);
  app.use(errorHandler(deps.logger));
  return app;
}
