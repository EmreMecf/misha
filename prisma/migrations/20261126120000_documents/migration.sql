-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('UPLOADED', 'VALIDATING', 'QUEUED', 'CLASSIFYING', 'EXTRACTING', 'OCR_PROCESSING', 'AI_PROCESSING', 'VALIDATION_REQUIRED', 'ACCOUNTING_PENDING', 'NEEDS_REVIEW', 'APPROVED', 'EXPORT_PENDING', 'EXPORTING', 'EXPORTED', 'FAILED', 'DUPLICATE', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DocumentFormat" AS ENUM ('XML', 'PDF', 'IMAGE', 'SPREADSHEET', 'CSV', 'ZIP', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('E_INVOICE', 'E_ARCHIVE_INVOICE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "InvoiceDirection" AS ENUM ('PURCHASE', 'SALE');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'DEAD');

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "taxpayer_id" UUID NOT NULL,
    "fiscal_period_id" UUID,
    "parent_document_id" UUID,
    "duplicate_of_id" UUID,
    "original_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "format" "DocumentFormat" NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "storage_key" VARCHAR(300),
    "status" "DocumentStatus" NOT NULL DEFAULT 'UPLOADED',
    "status_reason" VARCHAR(500),
    "document_type" "DocumentType" NOT NULL DEFAULT 'UNKNOWN',
    "direction" "InvoiceDirection",
    "ettn" VARCHAR(36),
    "document_no" VARCHAR(50),
    "document_date" DATE,
    "counterparty_tax_id" VARCHAR(11),
    "counterparty_name" VARCHAR(255),
    "payable_amount" DECIMAL(18,2),
    "currency" CHAR(3),
    "uploaded_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_status_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "from_status" "DocumentStatus",
    "to_status" "DocumentStatus" NOT NULL,
    "reason" VARCHAR(500),
    "actor_user_id" UUID,
    "actor_worker" VARCHAR(80),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_status_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_extractions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "parser" VARCHAR(40) NOT NULL,
    "parser_version" VARCHAR(20) NOT NULL,
    "method" VARCHAR(20) NOT NULL,
    "data" JSONB NOT NULL,
    "fields" JSONB NOT NULL,
    "validation" JSONB NOT NULL,
    "confidence" DECIMAL(4,3) NOT NULL,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_extractions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "taxpayer_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "extraction_id" UUID NOT NULL,
    "direction" "InvoiceDirection" NOT NULL,
    "profile_id" VARCHAR(40) NOT NULL,
    "invoice_type_code" VARCHAR(40) NOT NULL,
    "invoice_no" VARCHAR(50) NOT NULL,
    "ettn" VARCHAR(36) NOT NULL,
    "issue_date" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "exchange_rate" DECIMAL(18,6),
    "supplier_tax_id" VARCHAR(11),
    "supplier_name" VARCHAR(255),
    "customer_tax_id" VARCHAR(11),
    "customer_name" VARCHAR(255),
    "line_extension_amount" DECIMAL(18,2) NOT NULL,
    "allowance_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tax_exclusive_amount" DECIMAL(18,2) NOT NULL,
    "tax_inclusive_amount" DECIMAL(18,2) NOT NULL,
    "withholding_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "payable_amount" DECIMAL(18,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "name" VARCHAR(500) NOT NULL,
    "stock_code" VARCHAR(100),
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit_code" VARCHAR(10),
    "unit_price" DECIMAL(21,8),
    "discount_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "line_amount" DECIMAL(18,2) NOT NULL,
    "vat_rate" DECIMAL(5,2) NOT NULL,
    "vat_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_taxes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "tax_type_code" VARCHAR(10),
    "tax_name" VARCHAR(100) NOT NULL,
    "rate" DECIMAL(5,2),
    "taxable_amount" DECIMAL(18,2) NOT NULL,
    "tax_amount" DECIMAL(18,2) NOT NULL,
    "is_withholding" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "invoice_taxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "type" VARCHAR(60) NOT NULL,
    "idempotency_key" VARCHAR(200) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "run_after" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMPTZ(6),
    "locked_by" VARCHAR(80),
    "last_error" VARCHAR(2000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "documents_taxpayer_id_status_idx" ON "documents"("taxpayer_id", "status");

-- CreateIndex
CREATE INDEX "documents_taxpayer_id_sha256_idx" ON "documents"("taxpayer_id", "sha256");

-- CreateIndex
CREATE INDEX "documents_taxpayer_id_ettn_idx" ON "documents"("taxpayer_id", "ettn");

-- CreateIndex
CREATE INDEX "documents_organization_id_created_at_idx" ON "documents"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "document_status_events_document_id_created_at_idx" ON "document_status_events"("document_id", "created_at");

-- CreateIndex
CREATE INDEX "document_extractions_document_id_is_current_idx" ON "document_extractions"("document_id", "is_current");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_document_id_key" ON "invoices"("document_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_extraction_id_key" ON "invoices"("extraction_id");

-- CreateIndex
CREATE INDEX "invoices_taxpayer_id_issue_date_idx" ON "invoices"("taxpayer_id", "issue_date");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_lines_invoice_id_line_no_key" ON "invoice_lines"("invoice_id", "line_no");

-- CreateIndex
CREATE INDEX "invoice_taxes_invoice_id_idx" ON "invoice_taxes"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_idempotency_key_key" ON "jobs"("idempotency_key");

-- CreateIndex
CREATE INDEX "jobs_status_run_after_idx" ON "jobs"("status", "run_after");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_taxpayer_id_fkey" FOREIGN KEY ("taxpayer_id") REFERENCES "taxpayers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_fiscal_period_id_fkey" FOREIGN KEY ("fiscal_period_id") REFERENCES "fiscal_periods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_parent_document_id_fkey" FOREIGN KEY ("parent_document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_duplicate_of_id_fkey" FOREIGN KEY ("duplicate_of_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_status_events" ADD CONSTRAINT "document_status_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_status_events" ADD CONSTRAINT "document_status_events_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_extractions" ADD CONSTRAINT "document_extractions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_extractions" ADD CONSTRAINT "document_extractions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_taxpayer_id_fkey" FOREIGN KEY ("taxpayer_id") REFERENCES "taxpayers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_extraction_id_fkey" FOREIGN KEY ("extraction_id") REFERENCES "document_extractions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_taxes" ADD CONSTRAINT "invoice_taxes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_taxes" ADD CONSTRAINT "invoice_taxes_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- =====================================================================
-- Elle eklenen kısımlar
-- =====================================================================

-- Mükerrer kontrolü: aynı mükellefte aynı içerik (SHA-256) ve aynı ETTN yalnızca bir kez "asıl" belge olabilir.
-- Mükerrer olarak işaretlenen veya reddedilen kayıtlar bu kurala dahil değildir.
CREATE UNIQUE INDEX "documents_taxpayer_sha256_unique" ON "documents" ("taxpayer_id", "sha256")
  WHERE "status" NOT IN ('DUPLICATE', 'REJECTED');
CREATE UNIQUE INDEX "documents_taxpayer_ettn_unique" ON "documents" ("taxpayer_id", "ettn")
  WHERE "ettn" IS NOT NULL AND "status" NOT IN ('DUPLICATE', 'REJECTED');

ALTER TABLE "documents" ADD CONSTRAINT "documents_sha256_hex" CHECK ("sha256" ~ '^[0-9a-f]{64}$');
ALTER TABLE "documents" ADD CONSTRAINT "documents_size_positive" CHECK ("size_bytes" > 0);
ALTER TABLE "documents" ADD CONSTRAINT "documents_ettn_format" CHECK ("ettn" IS NULL OR "ettn" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
ALTER TABLE "documents" ADD CONSTRAINT "documents_duplicate_has_origin" CHECK ("status" <> 'DUPLICATE' OR "duplicate_of_id" IS NOT NULL);
ALTER TABLE "document_extractions" ADD CONSTRAINT "document_extractions_confidence_range" CHECK ("confidence" >= 0 AND "confidence" <= 1);
-- Belge başına en fazla bir güncel çıkarım
CREATE UNIQUE INDEX "document_extractions_one_current" ON "document_extractions" ("document_id") WHERE "is_current";
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_rate_range" CHECK ("vat_rate" >= 0 AND "vat_rate" <= 100);
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_attempts_range" CHECK ("attempts" >= 0 AND "max_attempts" > 0);

-- ---- Row Level Security ----
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['documents', 'document_status_events', 'document_extractions', 'invoices', 'invoice_lines', 'invoice_taxes'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org())', t || '_tenant', t);
  END LOOP;
END $$;

-- ---- Uygulama rolü yetkileri ----
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mihsap_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "documents", "document_extractions", "invoices", "invoice_lines", "invoice_taxes", "jobs" TO mihsap_app;
    GRANT DELETE ON "invoice_lines", "invoice_taxes", "invoices" TO mihsap_app;
    -- Durum geçmişi değiştirilemez
    GRANT SELECT, INSERT ON "document_status_events" TO mihsap_app;
  END IF;
END $$;
