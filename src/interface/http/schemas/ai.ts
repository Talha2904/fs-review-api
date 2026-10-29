import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

export const AiStepsSchema = z.object({ extract: z.boolean(), narrative: z.boolean(), explain: z.boolean(), version: z.boolean() });
export const AiSettingsSchema = z
  .object({
    enabled: z.boolean(),
    acknowledgement: z
      .object({ by: z.object({ id: z.string(), name: z.string() }), at: z.string(), text: z.string().optional() })
      .nullable(),
    steps: AiStepsSchema,
    model: z.string()
  })
  .openapi('AiSettings');
export const KeyStatusSchema = z.object({ configured: z.boolean(), last4: z.string() }).openapi('KeyStatus');

export const AiStatusResponse = AiSettingsSchema.extend({ serverKey: z.boolean() }).openapi('AiStatusResponse');
export const AiSettingsResponse = z.object({ settings: AiSettingsSchema, key: KeyStatusSchema }).openapi('AiSettingsResponse');
export const AiSettingsBody = z.object({ settings: z.unknown() }).openapi('AiSettingsBody');
export const AiTestResponse = z.object({ ok: z.literal(true), model: z.string(), ms: z.number() }).openapi('AiTestResponse');

/** Which fund an OCR request is for, for the activity log. */
const OcrContext = z.object({ engagementId: z.string().nullable().optional(), fundName: z.string().nullable().optional() }).optional();

export const OcrBody = z
  .object({ pages: z.array(z.object({ png: z.string() })).max(60), fileName: z.string().max(260).optional(), _ctx: OcrContext })
  .openapi('OcrBody');
export const OcrResponse = z
  .object({
    pages: z.array(
      z.object({
        lines: z.array(
          z.object({
            words: z.array(z.object({ text: z.string(), x0: z.number(), x1: z.number(), y0: z.number(), y1: z.number(), conf: z.number() }))
          })
        ),
        confidence: z.number()
      })
    )
  })
  .openapi('OcrResponse');
