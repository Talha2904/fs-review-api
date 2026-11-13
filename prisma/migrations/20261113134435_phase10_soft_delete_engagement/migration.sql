-- AlterTable
ALTER TABLE "engagements" ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "deleted_by" JSONB,
ADD COLUMN     "deleted_reason" TEXT;

-- CreateIndex
CREATE INDEX "engagements_deleted_at_idx" ON "engagements"("deleted_at");
