import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

// A group is named by its key (the lower-cased Client name) and year end; both travel as values, not in the
// path, because a client name may hold any character.
export const GroupQuery = z.object({ groupKey: z.string().min(1).max(300), yearEnd: z.string().max(20) });
export const StartConsolidatedBody = GroupQuery.openapi('StartConsolidatedBody');

const Person = z.object({ id: z.string(), name: z.string(), role: z.string() });
const RunSummary = z
  .object({
    id: z.string(),
    status: z.enum(['queued', 'running', 'done', 'failed']),
    step: z.number().int(),
    total: z.number().int(),
    error: z.string().nullable(),
    requestedBy: Person,
    createdAt: z.string(),
    finishedAt: z.string().nullable()
  })
  .openapi('ConsolidatedRunSummary');

export const ConsolidatedGroupsResponse = z
  .object({
    groups: z.array(
      z.object({
        groupKey: z.string(),
        groupName: z.string(),
        yearEnd: z.string(),
        funds: z.array(
          z.object({ engagementId: z.string(), fundName: z.string(), entityName: z.string(), analysed: z.boolean(), locked: z.boolean() })
        ),
        latest: RunSummary.nullable(),
        analysedCount: z.number().int()
      })
    )
  })
  .openapi('ConsolidatedGroupsResponse');

export const ConsolidatedReviewResponse = z
  .object({
    group: z.object({
      groupKey: z.string(),
      groupName: z.string(),
      yearEnd: z.string(),
      funds: z.array(
        z.object({
          engagementId: z.string(),
          fundName: z.string(),
          entityName: z.string(),
          currency: z.string(),
          analysed: z.boolean(),
          locked: z.boolean()
        })
      )
    }),
    latest: RunSummary.nullable(),
    review: z
      .object({
        id: z.string(),
        finishedAt: z.string().nullable(),
        requestedBy: Person,
        // links, unmatched lines, common point groups, summary and how AI was used (see shared consolidation.ts)
        result: z.record(z.unknown()).nullable(),
        /** the review read a fund that has since been deleted: its result is not returned until it is run again */
        withheld: z.literal('deletedFund').optional()
      })
      .nullable(),
    stale: z.object({ changed: z.array(z.string()), added: z.array(z.string()), removed: z.array(z.string()) }).nullable()
  })
  .openapi('ConsolidatedReviewResponse');

export const StartConsolidatedResponse = z
  .object({ review: RunSummary.extend({ groupKey: z.string(), yearEnd: z.string() }) })
  .openapi('StartConsolidatedResponse');
