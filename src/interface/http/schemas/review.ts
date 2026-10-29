import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

/** Documents the screens edit. The use cases validate the fields that matter; HTTP checks shape and size. */
export const EntityBody = z
  .object({ id: z.string().max(64).optional(), name: z.string().max(200) })
  .passthrough()
  .openapi('EntityBody');
export const EntitySchema = EntityBody.extend({ id: z.string() }).openapi('Entity');
export const EntitiesResponse = z.object({ entities: z.array(EntitySchema) }).openapi('EntitiesResponse');
export const EntityResponse = z.object({ entity: EntitySchema }).openapi('EntityResponse');

export const EngagementBody = z
  .object({
    id: z.string().max(64).optional(),
    entityId: z.string().max(64).optional(),
    fund: z.object({ name: z.string().max(200), yearEnd: z.string().max(10), currency: z.string().max(3).optional() }).passthrough()
  })
  .passthrough()
  .openapi('EngagementBody');
export const EngagementSchema = EngagementBody.extend({ id: z.string() }).openapi('Engagement');
export const EngagementsResponse = z.object({ engagements: z.array(EngagementSchema) }).openapi('EngagementsResponse');
export const EngagementResponse = z.object({ engagement: EngagementSchema }).openapi('EngagementResponse');

export const IdParams = z.object({ id: z.string().min(3).max(64) });

export const CheckRuleConfigSchema = z
  .object({
    rules: z.record(z.string(), z.unknown()),
    overrides: z.record(z.string(), z.unknown()),
    custom: z.array(z.unknown()),
    savedAt: z.string().optional()
  })
  .openapi('CheckRuleConfig');
export const CheckRuleConfigResponse = z.object({ config: CheckRuleConfigSchema.nullable() }).openapi('CheckRuleConfigResponse');
export const CheckRuleConfigBody = z.object({ config: z.unknown() }).openapi('CheckRuleConfigBody');

export const ChecklistItemSchema = z.object({
  id: z.string(),
  ref: z.string(),
  section: z.string(),
  text: z.string(),
  keywords: z.array(z.string())
});
export const ChecklistTemplateSchema = z
  .object({
    framework: z.string(),
    version: z.string(),
    items: z.array(ChecklistItemSchema),
    savedBy: z.string().nullable(),
    savedAt: z.string()
  })
  .openapi('ChecklistTemplate');
export const ChecklistsResponse = z.object({ checklists: z.record(z.string(), ChecklistTemplateSchema) }).openapi('ChecklistsResponse');
export const ChecklistResponse = z.object({ checklist: ChecklistTemplateSchema }).openapi('ChecklistResponse');
export const ChecklistBody = z.object({ items: z.array(z.unknown()).max(500) }).openapi('ChecklistBody');
export const FrameworkParams = z.object({ framework: z.string().min(2).max(40) });
