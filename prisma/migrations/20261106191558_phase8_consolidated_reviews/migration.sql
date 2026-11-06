-- CreateTable
CREATE TABLE "consolidated_reviews" (
    "id" TEXT NOT NULL,
    "group_key" TEXT NOT NULL,
    "group_name" TEXT NOT NULL,
    "year_end" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "step" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL,
    "error" TEXT,
    "run_ids" JSONB NOT NULL,
    "result" JSONB,
    "requested_by" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "consolidated_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "consolidated_reviews_group_key_year_end_created_at_idx" ON "consolidated_reviews"("group_key", "year_end", "created_at" DESC);

-- CreateIndex
CREATE INDEX "consolidated_reviews_status_idx" ON "consolidated_reviews"("status");
