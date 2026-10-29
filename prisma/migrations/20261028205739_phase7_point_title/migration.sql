-- A point's title in its own column (Phase 7 load test), so the bell can list points without reading their
-- whole content. Existing points take the title from their content.
ALTER TABLE "review_points" ADD COLUMN "title" TEXT;
UPDATE "review_points" SET "title" = COALESCE("content"->>'title', '');
ALTER TABLE "review_points" ALTER COLUMN "title" SET NOT NULL;
