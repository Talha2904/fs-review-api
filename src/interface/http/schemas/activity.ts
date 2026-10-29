import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

export const ActivityEntrySchema = z
  .object({
    id: z.string(),
    at: z.string(),
    actor: z.object({ id: z.string(), name: z.string(), username: z.string(), role: z.string() }).nullable(),
    category: z.string(),
    summary: z.string(),
    details: z.string(),
    ip: z.string(),
    engagementId: z.string().nullable(),
    fundName: z.string().nullable(),
    usage: z.object({ step: z.string(), model: z.string(), input: z.number(), output: z.number() }).optional()
  })
  .openapi('ActivityEntry');

/**
 * What the web app may record itself (Analysis: the trial balance mapping). Sign-in, Users, Permissions, AI and
 * Billing entries are written only by the api's own use cases, so they cannot be forged from a browser.
 */
export const CLIENT_CATEGORIES = [
  'Activity log',
  'Check rules',
  'Documents',
  'Engagements',
  'Review points',
  'Sign-off',
  'Analysis'
] as const;
export const ActivityBody = z
  .object({
    category: z.enum(CLIENT_CATEGORIES),
    summary: z.string().max(300),
    details: z.string().max(1000).optional(),
    engagementId: z.string().max(80).nullable().optional(),
    fundName: z.string().max(200).nullable().optional()
  })
  .openapi('ActivityBody');
export const ActivityQuery = z.object({
  engagementId: z.string().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(20000).optional()
});
export const ActivityResponse = z.object({ entries: z.array(ActivityEntrySchema) }).openapi('ActivityResponse');
export const ActivityEntryResponse = z.object({ entry: ActivityEntrySchema }).openapi('ActivityEntryResponse');
