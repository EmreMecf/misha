-- CreateEnum
CREATE TYPE "AccountRole" AS ENUM ('PURCHASE_DEFAULT', 'INPUT_VAT', 'SUPPLIER', 'VAT_WITHHOLDING', 'SALES_REVENUE', 'OUTPUT_VAT', 'CUSTOMER', 'SALES_RETURN');

-- CreateEnum
CREATE TYPE "JournalEntryStatus" AS ENUM ('DRAFT', 'POSTED', 'REVERSED');

-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "taxpayer_id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "is_postable" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_role_mappings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "taxpayer_id" UUID NOT NULL,
    "role" "AccountRole" NOT NULL,
    "account_id" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "account_role_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posting_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "taxpayer_id" UUID NOT NULL,
    "counterparty_tax_id" VARCHAR(11) NOT NULL,
    "counterparty_name" VARCHAR(255),
    "direction" "InvoiceDirection" NOT NULL,
    "account_id" UUID NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "posting_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "taxpayer_id" UUID NOT NULL,
    "fiscal_period_id" UUID NOT NULL,
    "document_id" UUID,
    "reversal_of_id" UUID,
    "entry_no" INTEGER,
    "entry_date" DATE NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "status" "JournalEntryStatus" NOT NULL DEFAULT 'DRAFT',
    "source" VARCHAR(20) NOT NULL,
    "direction" "InvoiceDirection",
    "counterparty_tax_id" VARCHAR(11),
    "counterparty_name" VARCHAR(255),
    "total_debit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total_credit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "findings" JSONB NOT NULL DEFAULT '[]',
    "created_by" UUID,
    "posted_by" UUID,
    "posted_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entry_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "account_id" UUID,
    "kind" VARCHAR(20) NOT NULL,
    "debit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "description" VARCHAR(300) NOT NULL,
    "source" VARCHAR(20) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "proposed_account_id" UUID,

    CONSTRAINT "journal_entry_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_corrections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "taxpayer_id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "counterparty_tax_id" VARCHAR(11),
    "direction" "InvoiceDirection",
    "line_kind" VARCHAR(20) NOT NULL,
    "proposed_account_id" UUID,
    "proposed_source" VARCHAR(20) NOT NULL,
    "chosen_account_id" UUID NOT NULL,
    "rule_created" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_taxpayer_id_code_key" ON "ledger_accounts"("taxpayer_id", "code");

-- CreateIndex
CREATE INDEX "account_role_mappings_account_id_idx" ON "account_role_mappings"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "account_role_mappings_taxpayer_id_role_key" ON "account_role_mappings"("taxpayer_id", "role");

-- CreateIndex
CREATE INDEX "posting_rules_account_id_idx" ON "posting_rules"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "posting_rules_taxpayer_id_counterparty_tax_id_direction_key" ON "posting_rules"("taxpayer_id", "counterparty_tax_id", "direction");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_reversal_of_id_key" ON "journal_entries"("reversal_of_id");

-- CreateIndex
CREATE INDEX "journal_entries_taxpayer_id_status_entry_date_idx" ON "journal_entries"("taxpayer_id", "status", "entry_date");

-- CreateIndex
CREATE INDEX "journal_entries_document_id_idx" ON "journal_entries"("document_id");

-- CreateIndex
CREATE INDEX "journal_entries_taxpayer_id_counterparty_tax_id_idx" ON "journal_entries"("taxpayer_id", "counterparty_tax_id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_fiscal_period_id_entry_no_key" ON "journal_entries"("fiscal_period_id", "entry_no");

-- CreateIndex
CREATE INDEX "journal_entry_lines_account_id_idx" ON "journal_entry_lines"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entry_lines_entry_id_line_no_key" ON "journal_entry_lines"("entry_id", "line_no");

-- CreateIndex
CREATE INDEX "account_corrections_taxpayer_id_counterparty_tax_id_idx" ON "account_corrections"("taxpayer_id", "counterparty_tax_id");

-- AddForeignKey
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_taxpayer_id_fkey" FOREIGN KEY ("taxpayer_id") REFERENCES "taxpayers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_role_mappings" ADD CONSTRAINT "account_role_mappings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_role_mappings" ADD CONSTRAINT "account_role_mappings_taxpayer_id_fkey" FOREIGN KEY ("taxpayer_id") REFERENCES "taxpayers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_role_mappings" ADD CONSTRAINT "account_role_mappings_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_rules" ADD CONSTRAINT "posting_rules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_rules" ADD CONSTRAINT "posting_rules_taxpayer_id_fkey" FOREIGN KEY ("taxpayer_id") REFERENCES "taxpayers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_rules" ADD CONSTRAINT "posting_rules_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_taxpayer_id_fkey" FOREIGN KEY ("taxpayer_id") REFERENCES "taxpayers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_fiscal_period_id_fkey" FOREIGN KEY ("fiscal_period_id") REFERENCES "fiscal_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversal_of_id_fkey" FOREIGN KEY ("reversal_of_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_corrections" ADD CONSTRAINT "account_corrections_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_corrections" ADD CONSTRAINT "account_corrections_taxpayer_id_fkey" FOREIGN KEY ("taxpayer_id") REFERENCES "taxpayers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_corrections" ADD CONSTRAINT "account_corrections_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- =====================================================================
-- Elle eklenen kısımlar
-- =====================================================================

ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_code_format" CHECK ("code" ~ '^[0-9]{3}([.][0-9A-Za-z]{1,10})*$');
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_amounts" CHECK ("debit" >= 0 AND "credit" >= 0 AND (("debit" > 0) <> ("credit" > 0)));
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_kind" CHECK ("kind" IN ('MAIN', 'VAT', 'COUNTERPARTY', 'WITHHOLDING', 'OTHER_TAX', 'MANUAL'));
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_entry_no_positive" CHECK ("entry_no" IS NULL OR "entry_no" > 0);
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_posted_has_no" CHECK ("status" = 'DRAFT' OR "entry_no" IS NOT NULL);
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_source" CHECK ("source" IN ('RULE_ENGINE', 'MANUAL', 'REVERSAL'));

-- Bir belgenin aynı anda tek bir geçerli (taslak veya kesin) fişi olabilir; ters kayıtlar hariç
CREATE UNIQUE INDEX "journal_entries_document_active" ON "journal_entries" ("document_id")
  WHERE "document_id" IS NOT NULL AND "reversal_of_id" IS NULL AND "status" <> 'REVERSED';

-- ---- Fiş kuralları (uygulama atlansa bile veritabanı uygular) ----
-- 1) Kesinleşme anında: en az iki satır, boş hesap yok, borç = alacak > 0, mali dönem açık. Toplamlar burada yazılır.
-- 2) Kesinleşmiş fiş değiştirilemez; tek izinli değişiklik POSTED -> REVERSED (ters kayıtla iptal).
CREATE FUNCTION journal_entry_before_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  d numeric(18, 2);
  c numeric(18, 2);
  n integer;
  missing integer;
  period_status text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status <> 'DRAFT' THEN
    IF OLD.status = 'POSTED' AND NEW.status = 'REVERSED'
       AND NEW.entry_no = OLD.entry_no AND NEW.entry_date = OLD.entry_date
       AND NEW.fiscal_period_id = OLD.fiscal_period_id AND NEW.taxpayer_id = OLD.taxpayer_id
       AND NEW.total_debit = OLD.total_debit AND NEW.total_credit = OLD.total_credit
       AND NEW.description = OLD.description THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Kesinleşmiş fiş değiştirilemez; düzeltme ters kayıtla yapılır' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status = 'REVERSED' THEN
    RAISE EXCEPTION 'Fiş yalnızca kesinleşmiş durumdan iptal edilebilir' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status = 'POSTED' THEN
    SELECT coalesce(sum(debit), 0), coalesce(sum(credit), 0), count(*), count(*) FILTER (WHERE account_id IS NULL)
      INTO d, c, n, missing
      FROM journal_entry_lines WHERE entry_id = NEW.id;
    IF n < 2 THEN
      RAISE EXCEPTION 'Fişte en az iki satır olmalı' USING ERRCODE = 'check_violation';
    END IF;
    IF missing > 0 THEN
      RAISE EXCEPTION 'Hesabı seçilmemiş % satır var' , missing USING ERRCODE = 'check_violation';
    END IF;
    IF d <> c OR d = 0 THEN
      RAISE EXCEPTION 'Fiş dengesiz: borç %, alacak %', d, c USING ERRCODE = 'check_violation';
    END IF;
    SELECT status::text INTO period_status FROM fiscal_periods WHERE id = NEW.fiscal_period_id;
    IF period_status IS DISTINCT FROM 'OPEN' THEN
      RAISE EXCEPTION 'Mali dönem açık değil' USING ERRCODE = 'check_violation';
    END IF;
    NEW.total_debit := d;
    NEW.total_credit := c;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "journal_entries_before_write" BEFORE INSERT OR UPDATE ON "journal_entries"
  FOR EACH ROW EXECUTE FUNCTION journal_entry_before_write();

-- Kesinleşmiş fiş silinemez. Ofis/mükellef kaydı silinirken (cascade) izin verilir.
CREATE FUNCTION journal_entry_before_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'DRAFT'
     AND EXISTS (SELECT 1 FROM taxpayers WHERE id = OLD.taxpayer_id) THEN
    RAISE EXCEPTION 'Kesinleşmiş fiş silinemez; ters kayıt kullanın' USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;

CREATE TRIGGER "journal_entries_before_delete" BEFORE DELETE ON "journal_entries"
  FOR EACH ROW EXECUTE FUNCTION journal_entry_before_delete();

-- Satırlar yalnızca taslak fişte değişir; hesap aynı mükellefin aktif ve kayıt yapılabilir hesabı olmalı.
CREATE FUNCTION journal_line_before_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  e record;
  a record;
BEGIN
  SELECT status, taxpayer_id INTO e FROM journal_entries WHERE id = coalesce(NEW.entry_id, OLD.entry_id);
  IF NOT FOUND THEN
    -- Fiş zaten siliniyor (cascade)
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Fiş bulunamadı' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF e.status <> 'DRAFT' THEN
    IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM taxpayers WHERE id = e.taxpayer_id) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Kesinleşmiş fişin satırları değiştirilemez' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF NEW.account_id IS NOT NULL THEN
    SELECT taxpayer_id, is_active, is_postable INTO a FROM ledger_accounts WHERE id = NEW.account_id;
    IF NOT FOUND OR a.taxpayer_id <> e.taxpayer_id THEN
      RAISE EXCEPTION 'Hesap bu mükellefin hesap planında değil' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT a.is_active OR NOT a.is_postable THEN
      RAISE EXCEPTION 'Hesap pasif veya kayıt yapılamaz (ana hesap)' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "journal_entry_lines_before_write" BEFORE INSERT OR UPDATE OR DELETE ON "journal_entry_lines"
  FOR EACH ROW EXECUTE FUNCTION journal_line_before_write();

-- Rol ve kural hesapları aynı mükellefe ait olmalı
CREATE FUNCTION ledger_account_same_taxpayer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ledger_accounts WHERE id = NEW.account_id AND taxpayer_id = NEW.taxpayer_id) THEN
    RAISE EXCEPTION 'Hesap bu mükellefin hesap planında değil' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "account_role_mappings_same_taxpayer" BEFORE INSERT OR UPDATE ON "account_role_mappings"
  FOR EACH ROW EXECUTE FUNCTION ledger_account_same_taxpayer();
CREATE TRIGGER "posting_rules_same_taxpayer" BEFORE INSERT OR UPDATE ON "posting_rules"
  FOR EACH ROW EXECUTE FUNCTION ledger_account_same_taxpayer();

-- ---- Row Level Security ----
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ledger_accounts', 'account_role_mappings', 'posting_rules', 'journal_entries', 'journal_entry_lines', 'account_corrections'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org())', t || '_tenant', t);
  END LOOP;
END $$;

-- ---- Uygulama rolü yetkileri ----
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mihsap_app') THEN
    -- Hesaplar silinmez, pasifleştirilir
    GRANT SELECT, INSERT, UPDATE ON "ledger_accounts", "posting_rules" TO mihsap_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "account_role_mappings" TO mihsap_app;
    -- Silme yalnızca taslak fişte mümkün (tetikleyici)
    GRANT SELECT, INSERT, UPDATE, DELETE ON "journal_entries", "journal_entry_lines" TO mihsap_app;
    -- Öğrenme kaydı değiştirilemez
    GRANT SELECT, INSERT ON "account_corrections" TO mihsap_app;
  END IF;
END $$;
