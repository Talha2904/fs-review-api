-- CreateTable
CREATE TABLE "document_versions" (
    "id" TEXT NOT NULL,
    "engagement_id" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "file_name" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "sample" BOOLEAN NOT NULL,
    "storage_key" TEXT,
    "uploaded_by" JSONB,
    "uploaded_at" TIMESTAMP(3) NOT NULL,
    "removed_at" TIMESTAMP(3),
    "removed_by" JSONB,
    "validation" JSONB,
    "confirmation" JSONB,
    "read_with" TEXT,
    "read_with_by" JSONB,
    "read_with_at" TIMESTAMP(3),
    "same_as" INTEGER,

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflows" (
    "engagement_id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "by" JSONB,
    "at" TIMESTAMP(3),
    "reason" TEXT NOT NULL DEFAULT '',
    "history" JSONB NOT NULL,

    CONSTRAINT "workflows_pkey" PRIMARY KEY ("engagement_id")
);

-- CreateTable
CREATE TABLE "signoffs" (
    "engagement_id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "by" JSONB,
    "at" TIMESTAMP(3),
    "text" TEXT NOT NULL DEFAULT '',
    "summary" JSONB,
    "history" JSONB NOT NULL,

    CONSTRAINT "signoffs_pkey" PRIMARY KEY ("engagement_id")
);

-- CreateIndex
CREATE INDEX "document_versions_engagement_id_sha256_idx" ON "document_versions"("engagement_id", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_engagement_id_slot_version_key" ON "document_versions"("engagement_id", "slot", "version");

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "engagements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "engagements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signoffs" ADD CONSTRAINT "signoffs_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "engagements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
