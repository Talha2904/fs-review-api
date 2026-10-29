// ESLint flat config for the api package.
// The import-boundary rules are what keep the clean architecture honest:
// only infrastructure/ may import vendor packages, each in its own folder, and inner layers
// may not import outer ones. A violation fails `npm run lint` and therefore CI.
import js from '@eslint/js';
import importPlugin from 'eslint-plugin-import';
import tseslint from 'typescript-eslint';

// Vendor packages and the only folder that may import each of them.
const VENDORS = [
  { name: '@prisma/client', folder: 'infrastructure/db' },
  { name: '@aws-sdk/client-s3', folder: 'infrastructure/storage' },
  { name: '@anthropic-ai/sdk', folder: 'infrastructure/ai' },
  { name: 'tesseract.js', folder: 'infrastructure/ocr' },
  { name: 'pdfjs-dist', folder: 'infrastructure/documents' },
  { name: 'xlsx', folder: 'infrastructure/documents' },
  { name: 'canvas', folder: 'infrastructure/documents' },
  { name: 'nodemailer', folder: 'infrastructure/mail' },
  { name: 'ioredis', folder: 'infrastructure/events' },
  { name: 'pino', folder: 'infrastructure/logging' },
  { name: 'pino-http', folder: 'infrastructure/logging' },
  { name: 'express', folder: 'interface/http' },
  { name: 'cors', folder: 'interface/http' },
  { name: 'helmet', folder: 'interface/http' },
  { name: 'swagger-ui-express', folder: 'interface/http' }
];
const NEVER = [{ name: '@supabase/supabase-js', message: 'The Supabase SDK is not used. Talk to the database through Prisma only.' }];

const vendorPaths = (allowedFolder) =>
  VENDORS.filter((v) => v.folder !== allowedFolder).map((v) => ({
    name: v.name,
    message: `"${v.name}" may only be imported under src/${v.folder}/. Depend on a port in application/ports instead.`
  }));

const layer = (files, allowedFolder, patterns = []) => ({
  files,
  rules: {
    'no-restricted-imports': ['error', { paths: [...NEVER, ...vendorPaths(allowedFolder)], patterns }]
  }
});

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'test/parity/web-engine/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { import: importPlugin },
    settings: { 'import/resolver': { typescript: true, node: true } },
    rules: {
      'import/no-cycle': 'error',
      'import/order': [
        'error',
        {
          'newlines-between': 'always',
          alphabetize: { order: 'asc' },
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index']
        }
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }
      ]
    }
  },
  // Layer rules. Domain knows nothing. Application knows domain and its own ports.
  // Infrastructure implements ports. Interface wires HTTP to use cases. Nobody imports interface.
  layer(['src/domain/**/*.ts'], null, [
    {
      group: ['**/application/**', '**/infrastructure/**', '**/interface/**', '**/config/**'],
      message: 'domain/ must not import outer layers.'
    }
  ]),
  layer(['src/application/**/*.ts'], null, [
    {
      group: ['**/infrastructure/**', '**/interface/**'],
      message: 'application/ must not import infrastructure or interface. Depend on a port.'
    }
  ]),
  layer(['src/config/**/*.ts', 'src/container.ts'], null),
  layer(['src/interface/http/**/*.ts'], 'interface/http', [
    {
      group: ['**/infrastructure/**'],
      message: 'interface/ receives adapters from container.ts; it does not import infrastructure directly.'
    }
  ]),
  ...[...new Set(VENDORS.map((v) => v.folder))]
    .filter((f) => f.startsWith('infrastructure/'))
    .map((folder) => layer([`src/${folder}/**/*.ts`], folder)),
  layer(['src/infrastructure/clock/**/*.ts', 'src/infrastructure/ids/**/*.ts'], null),
  { files: ['test/**/*.ts', 'vitest.config.ts', 'eslint.config.js'], rules: { 'no-restricted-imports': 'off' } }
);
