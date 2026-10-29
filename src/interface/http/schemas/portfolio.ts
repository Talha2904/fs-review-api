import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

const Team = z.object({ preparer: z.string(), reviewer: z.string(), manager: z.string(), partner: z.string() });
export const PortfolioResponse = z
  .object({
    rows: z.array(
      z.object({
        engagementId: z.string(),
        client: z.string(),
        fund: z.string(),
        yearEnd: z.string(),
        stage: z.string(),
        order: z.number().int(),
        tab: z.enum(['docs', 'sched', 'signoff']),
        owner: z.enum(['preparer', 'reviewer', 'manager', 'partner']).nullable(),
        ownerName: z.string(),
        team: Team,
        teamIds: z.array(z.string()),
        open: z.number().int(),
        responded: z.number().int(),
        overdue: z.number().int(),
        lastActivityAt: z.string().nullable()
      })
    )
  })
  .openapi('PortfolioResponse');
const Notice = z
  .object({
    id: z.string(),
    engagementId: z.string(),
    fund: z.string(),
    key: z.string(),
    title: z.string(),
    detail: z.string().optional(),
    at: z.string().nullable().optional(),
    tab: z.enum(['docs', 'sched', 'signoff']),
    ref: z.string().optional()
  })
  .openapi('Notice');
export const NotificationsResponse = z
  .object({
    actions: z.array(Notice).openapi({ description: 'what needs the signed-in person, newest first; at most 50' }),
    actionCount: z.number().int().openapi({ description: 'how many actions there are in all' }),
    updates: z.array(Notice).openapi({ description: 'the newest 60 updates from other people, from the last 90 days' })
  })
  .openapi('NotificationsResponse');
