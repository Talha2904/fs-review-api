import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

export const HealthResponse = z
  .object({
    status: z.enum(['ok', 'degraded']),
    version: z.string(),
    uptimeSeconds: z.number().int().nonnegative(),
    checks: z.object({ database: z.enum(['ok', 'down', 'skipped']) }),
    time: z.string().datetime()
  })
  .openapi('HealthResponse');

export type HealthResponse = z.infer<typeof HealthResponse>;
