// Entry point: load config, build the container, start listening, stop cleanly on SIGTERM.
import { loadEnv } from '../../config/env.js';
import { buildContainer } from '../../container.js';

import { createApp } from './app.js';

const env = loadEnv();
const c = buildContainer(env);
const startedAt = Date.now();

const app = createApp({
  logger: c.logger,
  httpLogger: c.httpLogger,
  corsOrigins: env.CORS_ORIGINS,
  version: c.version,
  secureCookies: env.NODE_ENV === 'production',
  trustProxy: env.TRUST_PROXY,
  docsPublic: env.NODE_ENV !== 'production' || env.DOCS_PUBLIC,
  health: { startedAt, pingDatabase: c.pingDatabase },
  uc: c.uc,
  permissions: c.permissions,
  events: c.events
});

const server = app.listen(env.PORT, () => {
  c.logger.info(
    {
      port: env.PORT,
      env: env.NODE_ENV,
      version: c.version,
      docs: `http://localhost:${env.PORT}/api/docs`,
      aiKey: env.ANTHROPIC_API_KEY && env.ANTHROPIC_API_KEY.length > 10 ? 'configured' : 'missing',
      mail: c.mailer.configured ? 'on' : 'off'
    },
    'FS Review api listening'
  );
});
const stopSchedulers = c.startSchedulers();

const stop = (signal: string) => {
  c.logger.info({ signal }, 'Shutting down');
  stopSchedulers();
  server.close(() => {
    void c.shutdown().then(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
