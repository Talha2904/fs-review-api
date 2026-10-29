-- AlterTable
ALTER TABLE "invoice_transactions" ALTER COLUMN "reason" DROP DEFAULT,
ALTER COLUMN "reference" DROP DEFAULT;

-- AlterTable
ALTER TABLE "signoffs" ALTER COLUMN "text" DROP DEFAULT;

-- AlterTable
ALTER TABLE "workflows" ALTER COLUMN "reason" DROP DEFAULT;
