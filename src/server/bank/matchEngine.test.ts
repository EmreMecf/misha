import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { nameTokens, suggest, type InvoiceCandidate, type RuleCandidate } from "./matchEngine";

const d = (v: string) => new Decimal(v);
const date = (iso: string) => new Date(`${iso}T00:00:00Z`);

const inv = (over: Partial<InvoiceCandidate>): InvoiceCandidate => ({
  documentId: "doc-1",
  direction: "PURCHASE",
  invoiceNo: "ORN2026000000011",
  issueDate: date("2026-10-15"),
  payable: d("1209.00"),
  counterpartyTaxId: "1234567890",
  counterpartyName: "ÖRNEK TEDARİK A.Ş.",
  ...over,
});

const RULES: RuleCandidate[] = [
  { id: "r1", keyword: "EFT ÜCRETİ", direction: "OUT", account: { id: "a780", code: "780", name: "Finansman Giderleri" } },
  { id: "r2", keyword: "ÜCRET", direction: "ANY", account: { id: "a653", code: "653", name: "Komisyon Giderleri" } },
];

describe("banka eşleştirme önerisi", () => {
  it("tutar + fatura no + ad + tarih: yüksek güvenle fatura önerilir, gerekçeler yazılır", () => {
    const s = suggest({ amount: d("-1209.00"), txDate: date("2026-10-20"), description: "EFT ÖRNEK TEDARİK A.Ş. FT ORN2026000000011" }, [inv({})], RULES);
    expect(s).toMatchObject({ kind: "INVOICE", documentId: "doc-1", confidence: "high", ambiguous: false });
    expect(s!.reasons).toEqual([
      "Tutar faturanın ödenecek tutarına eşit (1.209,00 TL)",
      "Açıklamada fatura no ORN2026000000011 geçiyor",
      "Açıklamada karşı taraf adı geçiyor (ORNEK, TEDARIK)",
      "Fatura tarihinden 5 gün sonra",
      "Bu tutarda eşleşmemiş başka fatura yok",
    ]);
  });

  it("yön tutmalı: giriş hareketi alış faturasıyla eşleşmez", () => {
    expect(suggest({ amount: d("1209.00"), txDate: date("2026-10-20"), description: "ORN2026000000011" }, [inv({})], [])).toBeNull();
  });

  it("tutar farklıysa fatura önerilmez (kısmi ödeme sonraki adım)", () => {
    expect(suggest({ amount: d("-1200.00"), txDate: date("2026-10-20"), description: "ORN2026000000011" }, [inv({})], [])).toBeNull();
  });

  it("aynı tutarda iki fatura: açıklamadaki VKN doğru olanı seçer", () => {
    const a = inv({ documentId: "a", counterpartyTaxId: "1111111111", counterpartyName: "BIRINCI FIRMA" });
    const b = inv({ documentId: "b", counterpartyTaxId: "2222222222", counterpartyName: "IKINCI FIRMA" });
    const s = suggest({ amount: d("-1209.00"), txDate: date("2026-10-16"), description: "Havale VKN 2222222222" }, [a, b], []);
    expect(s).toMatchObject({ kind: "INVOICE", documentId: "b", ambiguous: false });
  });

  it("aynı tutarda iki fatura ve ayırt edici bilgi yoksa öneri yapılmaz", () => {
    const a = inv({ documentId: "a", counterpartyName: "BIRINCI", counterpartyTaxId: null });
    const b = inv({ documentId: "b", counterpartyName: "IKINCI", counterpartyTaxId: null });
    expect(suggest({ amount: d("-1209.00"), txDate: date("2026-10-16"), description: "Ödeme" }, [a, b], [])).toBeNull();
  });

  it("faturadan önceki hareket puan kaybeder ve gerekçede belirtilir", () => {
    const s = suggest({ amount: d("-1209.00"), txDate: date("2026-10-01"), description: "ORN2026000000011" }, [inv({})], []);
    expect(s!.reasons).toContain("Hareket fatura tarihinden 14 gün önce (avans olabilir)");
  });

  it("fatura yoksa en uzun eşleşen anahtar kelime kuralı (yön dahil)", () => {
    const out = suggest({ amount: d("-6.50"), txDate: date("2026-10-05"), description: "EFT Ücreti BSMV dahil" }, [], RULES);
    expect(out).toMatchObject({ kind: "RULE", ruleId: "r1", account: { code: "780" } });
    const incoming = suggest({ amount: d("6.50"), txDate: date("2026-10-05"), description: "EFT ÜCRETİ iadesi" }, [], RULES);
    expect(incoming).toMatchObject({ kind: "RULE", ruleId: "r2" });
  });

  it("ad belirteçleri şirket türü kelimelerini atar", () => {
    expect(nameTokens("ÖRNEK GIDA TİCARET LTD. ŞTİ.")).toEqual(["ORNEK"]);
  });
});
