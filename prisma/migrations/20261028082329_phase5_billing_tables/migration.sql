-- CreateTable
CREATE TABLE "billing_settings" (
    "id" INTEGER NOT NULL,
    "settings" JSONB NOT NULL,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_events" (
    "engagement_id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "fund_name" TEXT NOT NULL,
    "client_name" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_events_pkey" PRIMARY KEY ("engagement_id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "number" TEXT,
    "engagement_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "client_name" TEXT NOT NULL,
    "fund_name" TEXT NOT NULL,
    "issued_at" TIMESTAMP(3),
    "due_date" TIMESTAMP(3),
    "gross_pence" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_transactions" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "number" TEXT,
    "reason" TEXT NOT NULL DEFAULT '',
    "reference" TEXT NOT NULL DEFAULT '',
    "by" JSONB,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_sequences" (
    "name" TEXT NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "billing_sequences_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoices_number_key" ON "invoices"("number");

-- CreateIndex
CREATE INDEX "invoices_engagement_id_idx" ON "invoices"("engagement_id");

-- CreateIndex
CREATE INDEX "invoices_status_idx" ON "invoices"("status");

-- CreateIndex
CREATE INDEX "invoice_transactions_invoice_id_idx" ON "invoice_transactions"("invoice_id");

-- AddForeignKey
ALTER TABLE "invoice_transactions" ADD CONSTRAINT "invoice_transactions_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
