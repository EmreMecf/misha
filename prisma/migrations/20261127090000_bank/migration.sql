-- CreateEnum
CREATE TYPE "BalanceCheck" AS ENUM ('OK', 'MISMATCH', 'NO_BALANCE');

-- CreateEnum
CREATE TYPE "BankTransactionStatus" AS ENUM ('UNMATCHED', 'MATCHED', 'IGNORED');

-- CreateEnum
CREATE TYPE "BankRuleDirection" AS ENUM ('IN', 'OUT', 'ANY');

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "taxpayer_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "bank_name" VARCHAR(120),
    "iban" VARCHAR(34),
    "currency" CHAR(3) NOT NULL DEFAULT 'TRY',
    "ledger_account_id" UUID NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_statements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "taxpayer_id" UUID NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "format" VARCHAR(10) NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "opening_balance" DECIMAL(18,2),
    "closing_balance" DECIMAL(18,2),
    "row_count" INTEGER NOT NULL,
    "imported_count" INTEGER NOT NULL,
    "duplicate_count" INTEGER NOT NULL,
    "balance_check" "BalanceCheck" NOT NULL,
    "mapping" JSONB NOT NULL,
    "findings" JSONB NOT NULL DEFAULT '[]',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "taxpayer_id" UUID NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "statement_id" UUID NOT NULL,
    "row_no" INTEGER NOT NULL,
    "tx_date" DATE NOT NULL,
    "value_date" DATE,
    "description" VARCHAR(500) NOT NULL,
    "reference" VARCHAR(100),
    "amount" DECIMAL(18,2) NOT NULL,
    "balance" DECIMAL(18,2),
    "fingerprint" CHAR(64) NOT NULL,
    "status" "BankTransactionStatus" NOT NULL DEFAULT 'UNMATCHED',
    "matched_document_id" UUID,
    "journal_entry_id" UUID,
    "match_reason" VARCHAR(500),
    "matched_by" UUID,
    "matched_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bank_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "taxpayer_id" UUID NOT NULL,
    "keyword" VARCHAR(100) NOT NULL,
    "direction" "BankRuleDirection" NOT NULL DEFAULT 'ANY',
    "account_id" UUID NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bank_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bank_accounts_ledger_account_id_idx" ON "bank_accounts"("ledger_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_taxpayer_id_name_key" ON "bank_accounts"("taxpayer_id", "name");

-- CreateIndex
CREATE INDEX "bank_statements_bank_account_id_period_end_idx" ON "bank_statements"("bank_account_id", "period_end");

-- CreateIndex
CREATE UNIQUE INDEX "bank_statements_bank_account_id_sha256_key" ON "bank_statements"("bank_account_id", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transactions_journal_entry_id_key" ON "bank_transactions"("journal_entry_id");

-- CreateIndex
CREATE INDEX "bank_transactions_bank_account_id_status_tx_date_idx" ON "bank_transactions"("bank_account_id", "status", "tx_date");

-- CreateIndex
CREATE INDEX "bank_transactions_statement_id_idx" ON "bank_transactions"("statement_id");

-- CreateIndex
CREATE INDEX "bank_transactions_matched_document_id_idx" ON "bank_transactions"("matched_document_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transactions_bank_account_id_fingerprint_key" ON "bank_transactions"("bank_account_id", "fingerprint");

-- CreateIndex
CREATE INDEX "bank_rules_account_id_idx" ON "bank_rules"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_rules_taxpayer_id_keyword_direction_key" ON "bank_rules"("taxpayer_id", "keyword", "direction");

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_taxpayer_id_fkey" FOREIGN KEY ("taxpayer_id") REFERENCES "taxpayers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_ledger_account_id_fkey" FOREIGN KEY ("ledger_account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_taxpayer_id_fkey" FOREIGN KEY ("taxpayer_id") REFERENCES "taxpayers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_taxpayer_id_fkey" FOREIGN KEY ("taxpayer_id") REFERENCES "taxpayers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_statement_id_fkey" FOREIGN KEY ("statement_id") REFERENCES "bank_statements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_matched_document_id_fkey" FOREIGN KEY ("matched_document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_rules" ADD CONSTRAINT "bank_rules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_rules" ADD CONSTRAINT "bank_rules_taxpayer_id_fkey" FOREIGN KEY ("taxpayer_id") REFERENCES "taxpayers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_rules" ADD CONSTRAINT "bank_rules_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- =====================================================================
-- Elle eklenen kısımlar
-- =====================================================================

ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_iban_format" CHECK ("iban" IS NULL OR "iban" ~ '^TR[0-9]{24}$');
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_sha256_hex" CHECK ("sha256" ~ '^[0-9a-f]{64}$');
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_period" CHECK ("period_start" <= "period_end");
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_counts" CHECK ("row_count" >= 0 AND "imported_count" >= 0 AND "duplicate_count" >= 0 AND "imported_count" + "duplicate_count" <= "row_count");
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_amount_nonzero" CHECK ("amount" <> 0);
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_fingerprint_hex" CHECK ("fingerprint" ~ '^[0-9a-f]{64}$');
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_matched_has_entry" CHECK ("status" <> 'MATCHED' OR "journal_entry_id" IS NOT NULL);
ALTER TABLE "bank_rules" ADD CONSTRAINT "bank_rules_keyword_length" CHECK (length(trim("keyword")) >= 3);

-- Bir fatura en fazla bir banka hareketiyle eşleşmiş olabilir (kısmi ödeme sonraki adım)
CREATE UNIQUE INDEX "bank_transactions_document_matched" ON "bank_transactions" ("matched_document_id")
  WHERE "matched_document_id" IS NOT NULL AND "status" = 'MATCHED';

-- Banka fişleri için kaynak ve satır türü genişletilir (veri korunur, yalnız kısıt yeniden tanımlanır)
ALTER TABLE "journal_entries" DROP CONSTRAINT "journal_entries_source";
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_source" CHECK ("source" IN ('RULE_ENGINE', 'MANUAL', 'REVERSAL', 'BANK'));
ALTER TABLE "journal_entry_lines" DROP CONSTRAINT "journal_entry_lines_kind";
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_kind" CHECK ("kind" IN ('MAIN', 'VAT', 'COUNTERPARTY', 'WITHHOLDING', 'OTHER_TAX', 'MANUAL', 'BANK'));

-- Banka hesabı ve kuralın defter hesabı aynı mükellefe ait olmalı
CREATE FUNCTION bank_ledger_account_same_taxpayer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE acc uuid;
BEGIN
  acc := CASE TG_TABLE_NAME WHEN 'bank_accounts' THEN NEW.ledger_account_id ELSE NEW.account_id END;
  IF NOT EXISTS (SELECT 1 FROM ledger_accounts WHERE id = acc AND taxpayer_id = NEW.taxpayer_id) THEN
    RAISE EXCEPTION 'Hesap bu mükellefin hesap planında değil' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "bank_accounts_same_taxpayer" BEFORE INSERT OR UPDATE ON "bank_accounts"
  FOR EACH ROW EXECUTE FUNCTION bank_ledger_account_same_taxpayer();
CREATE TRIGGER "bank_rules_same_taxpayer" BEFORE INSERT OR UPDATE ON "bank_rules"
  FOR EACH ROW EXECUTE FUNCTION bank_ledger_account_same_taxpayer();

-- Hareketin özü (tarih, tutar, açıklama, bakiye, parmak izi) aktarımdan sonra değiştirilemez
CREATE FUNCTION bank_transaction_immutable_core() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tx_date <> OLD.tx_date OR NEW.amount <> OLD.amount OR NEW.description <> OLD.description
     OR NEW.balance IS DISTINCT FROM OLD.balance OR NEW.fingerprint <> OLD.fingerprint
     OR NEW.bank_account_id <> OLD.bank_account_id OR NEW.statement_id <> OLD.statement_id THEN
    RAISE EXCEPTION 'Banka hareketinin ekstre verisi değiştirilemez' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "bank_transactions_immutable_core" BEFORE UPDATE ON "bank_transactions"
  FOR EACH ROW EXECUTE FUNCTION bank_transaction_immutable_core();

-- ---- Row Level Security ----
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bank_accounts', 'bank_statements', 'bank_transactions', 'bank_rules'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org())', t || '_tenant', t);
  END LOOP;
END $$;

-- ---- Uygulama rolü yetkileri ----
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mihsap_app') THEN
    -- Banka hesabı silinmez, pasifleştirilir; ekstre ve hareketler aktarım kaydıdır, silinmez
    GRANT SELECT, INSERT, UPDATE ON "bank_accounts", "bank_rules", "bank_transactions" TO mihsap_app;
    GRANT SELECT, INSERT ON "bank_statements" TO mihsap_app;
  END IF;
END $$;
