-- CreateTable
CREATE TABLE "check_rule_config" (
    "id" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "check_rule_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_templates" (
    "framework" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "saved_by" TEXT,
    "saved_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checklist_templates_pkey" PRIMARY KEY ("framework")
);

-- CreateTable
CREATE TABLE "checklist_template_versions" (
    "id" TEXT NOT NULL,
    "framework" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "saved_by" TEXT,
    "saved_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checklist_template_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entities" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "client_name" TEXT NOT NULL,
    "framework" TEXT NOT NULL,
    "ai_permitted" BOOLEAN,
    "data" JSONB NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engagements" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT,
    "fund_name" TEXT NOT NULL,
    "year_end" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "preparer_id" TEXT,
    "reviewer_id" TEXT,
    "manager_id" TEXT,
    "partner_id" TEXT,
    "data" JSONB NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "engagements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "checklist_template_versions_framework_version_key" ON "checklist_template_versions"("framework", "version");

-- CreateIndex
CREATE UNIQUE INDEX "entities_name_key_key" ON "entities"("name_key");

-- CreateIndex
CREATE INDEX "engagements_entity_id_idx" ON "engagements"("entity_id");

-- CreateIndex
CREATE INDEX "engagements_year_end_idx" ON "engagements"("year_end");

-- AddForeignKey
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
