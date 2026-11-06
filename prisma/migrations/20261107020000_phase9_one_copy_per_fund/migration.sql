-- One copy of a shared point per fund (NULLs never collide: unshared points are unaffected)
DROP INDEX "review_points_shared_group_id_idx";

-- CreateIndex
CREATE UNIQUE INDEX "review_points_shared_group_id_engagement_id_key" ON "review_points"("shared_group_id", "engagement_id");
