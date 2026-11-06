-- AlterTable
ALTER TABLE "review_points" ADD COLUMN     "shared_group_id" TEXT;

-- CreateIndex
CREATE INDEX "review_points_shared_group_id_idx" ON "review_points"("shared_group_id");
