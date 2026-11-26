-- Banka hesabı / kural tetikleyicisi: PL/pgSQL, tabloda olmayan NEW alanına (CASE dalında bile) erişemez.
-- Alan adı jsonb üzerinden okunur. Yalnız fonksiyon değişir; veri ve tetikleyiciler aynı kalır.
CREATE OR REPLACE FUNCTION bank_ledger_account_same_taxpayer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE acc uuid;
BEGIN
  acc := (to_jsonb(NEW) ->> CASE TG_TABLE_NAME WHEN 'bank_accounts' THEN 'ledger_account_id' ELSE 'account_id' END)::uuid;
  IF NOT EXISTS (SELECT 1 FROM ledger_accounts WHERE id = acc AND taxpayer_id = NEW.taxpayer_id) THEN
    RAISE EXCEPTION 'Hesap bu mükellefin hesap planında değil' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
