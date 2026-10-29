-- CreateTable
CREATE TABLE "analysis_runs" (
    "id" TEXT NOT NULL,
    "engagement_id" TEXT NOT NULL,
    "draft_version" INTEGER NOT NULL,
    "result" JSONB NOT NULL,
    "analysed_at" TIMESTAMP(3) NOT NULL,
    "settings_sig" TEXT NOT NULL,
    "document_versions" JSONB NOT NULL,
    "by" JSONB,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analysis_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_readings" (
    "key" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "reading" JSONB NOT NULL,
    "read_by" JSONB,
    "read_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_readings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "review_points" (
    "id" TEXT NOT NULL,
    "engagement_id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "due_date" TEXT,
    "assigned_to" JSONB,
    "raised_by" JSONB,
    "raised_at" TIMESTAMP(3) NOT NULL,
    "cleared_by" JSONB,
    "cleared_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "point_messages" (
    "id" TEXT NOT NULL,
    "point_id" TEXT NOT NULL,
    "engagement_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "author" JSONB,
    "at" TIMESTAMP(3) NOT NULL,
    "text" TEXT NOT NULL,
    "attachments" JSONB NOT NULL,

    CONSTRAINT "point_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "point_evidence" (
    "id" TEXT NOT NULL,
    "engagement_id" TEXT NOT NULL,
    "point_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "by" JSONB,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "point_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disclosure_checklists" (
    "engagement_id" TEXT NOT NULL,
    "framework" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "answers" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "disclosure_checklists_pkey" PRIMARY KEY ("engagement_id")
);

-- CreateTable
CREATE TABLE "review_reports" (
    "id" TEXT NOT NULL,
    "engagement_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "by" JSONB,
    "at" TIMESTAMP(3) NOT NULL,
    "signed_by" JSONB,
    "signed_at" TIMESTAMP(3),

    CONSTRAINT "review_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "analysis_runs_engagement_id_at_idx" ON "analysis_runs"("engagement_id", "at" DESC);

-- CreateIndex
CREATE INDEX "document_readings_sha256_idx" ON "document_readings"("sha256");

-- CreateIndex
CREATE INDEX "review_points_engagement_id_status_idx" ON "review_points"("engagement_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "review_points_engagement_id_ref_key" ON "review_points"("engagement_id", "ref");

-- CreateIndex
CREATE INDEX "point_messages_point_id_at_idx" ON "point_messages"("point_id", "at");

-- CreateIndex
CREATE INDEX "point_messages_engagement_id_at_idx" ON "point_messages"("engagement_id", "at");

-- CreateIndex
CREATE INDEX "point_evidence_engagement_id_idx" ON "point_evidence"("engagement_id");

-- CreateIndex
CREATE UNIQUE INDEX "review_reports_engagement_id_version_key" ON "review_reports"("engagement_id", "version");

-- AddForeignKey
ALTER TABLE "analysis_runs" ADD CONSTRAINT "analysis_runs_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "engagements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_points" ADD CONSTRAINT "review_points_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "engagements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "point_messages" ADD CONSTRAINT "point_messages_point_id_fkey" FOREIGN KEY ("point_id") REFERENCES "review_points"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "point_evidence" ADD CONSTRAINT "point_evidence_point_id_fkey" FOREIGN KEY ("point_id") REFERENCES "review_points"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disclosure_checklists" ADD CONSTRAINT "disclosure_checklists_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "engagements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "engagements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
