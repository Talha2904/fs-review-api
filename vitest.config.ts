import { config as loadDotenv } from 'dotenv';
import { defineConfig } from 'vitest/config';

// Only DATABASE_URL_TEST is taken from api/.env: it switches on the Postgres integration tests locally.
// Everything else the tests need is built in memory (test/helpers/fakes.ts).
const fromDotenv = loadDotenv({ path: new URL('.env', import.meta.url).pathname, processEnv: {} }).parsed ?? {};

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    env: { ...(fromDotenv.DATABASE_URL_TEST ? { DATABASE_URL_TEST: fromDotenv.DATABASE_URL_TEST } : {}) },
    coverage: {
      provider: 'v8',
      // domain and application, and the shared rules as the api's tests exercise them (definition of done: 80%)
      include: ['src/domain/**', 'src/application/**', 'shared/dist/**/*.js'],
      thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 }
    }
  }
});
