import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { proposeEntry, type AccountRef, type ProposalContext, type ProposalInvoice } from "./proposalEngine";

const acc = (code: string, name = code): AccountRef => ({ id: `id-${code}`, code, name });
const d = (v: string) => new Decimal(v);

const ROLES: ProposalContext["roles"] = {
  PURCHASE_DEFAULT: acc("153", "Ticari Mallar"),
  INPUT_VAT: acc("191", "İndirilecek KDV"),
  SUPPLIER: acc("320", "Satıcılar"),
  VAT_WITHHOLDING: acc("360", "Ödenecek Vergi ve Fonlar"),
  SALES_REVENUE: acc("600", "Yurt İçi Satışlar"),
  OUTPUT_VAT: acc("391", "Hesaplanan KDV"),
  CUSTOMER: acc("120", "Alıcılar"),
  SALES_RETURN: acc("610", "Satıştan İadeler"),
};

const vat = (amount: string, rate = "20") => ({ taxTypeCode: "0015", taxName: "KDV", rate: d(rate), taxAmount: d(amount), isWithholding: false });

function invoice(over: Partial<ProposalInvoice> = {}): ProposalInvoice {
  return {
    direction: "PURCHASE",
    invoiceTypeCode: "SATIS",
    invoiceNo: "ABC2026000000001",
    currency: "TRY",
    exchangeRate: null,
    taxExclusiveAmount: d("1000.00"),
    withholdingTotal: d("0"),
    payableAmount: d("1200.00"),
    taxes: [vat("200.00")],
    counterpartyTaxId: "1234567890",
    counterpartyName: "ÖRNEK TEDARİK A.Ş.",
    ...over,
  };
}

/** Satırları "hesap B/A tutar" biçiminde özetler */
const summary = (p: ReturnType<typeof proposeEntry>) =>
  p.lines.map((l) => `${l.accountId?.replace("id-", "") ?? "?"} ${l.debit.gt(0) ? "B" : "A"} ${(l.debit.gt(0) ? l.debit : l.credit).toFixed(2)}`);

describe("fiş önerisi", () => {
  it("alış: mal B, KDV B — satıcılar A; dengeli ve her satır gerekçeli", () => {
    const p = proposeEntry(invoice(), { roles: ROLES });
    expect(summary(p)).toEqual(["153 B 1000.00", "191 B 200.00", "320 A 1200.00"]);
    expect(p.totalDebit.eq(p.totalCredit)).toBe(true);
    expect(p.findings).toEqual([]);
    expect(p.lines.every((l) => l.reason.length > 0)).toBe(true);
    expect(p.lines[0]).toMatchObject({ source: "ROLE_MAPPING", kind: "MAIN" });
  });

  it("alış varsayılan hesabı yoksa ana satır boş kalır ve kesinleşemez", () => {
    const roles = { ...ROLES, PURCHASE_DEFAULT: undefined };
    const p = proposeEntry(invoice(), { roles });
    expect(p.lines[0]).toMatchObject({ accountId: null, source: "UNRESOLVED" });
    expect(p.findings.map((f) => f.code)).toContain("ACCOUNT_MISSING");
    expect(p.totalDebit.eq(p.totalCredit)).toBe(true);
  });

  it("karar önceliği: kesin kural > geçmiş onaylar > rol", () => {
    const history = { account: acc("760", "Pazarlama"), count: 4 };
    const withHistory = proposeEntry(invoice(), { roles: ROLES, history });
    expect(withHistory.lines[0]).toMatchObject({ accountId: "id-760", source: "HISTORY" });
    expect(withHistory.lines[0].reason).toMatch(/onaylanmış 4 fişte/);

    const withRule = proposeEntry(invoice(), { roles: ROLES, history, rule: acc("770", "Genel Yönetim Giderleri") });
    expect(withRule.lines[0]).toMatchObject({ accountId: "id-770", source: "POSTING_RULE" });
    expect(withRule.lines[0].reason).toMatch(/kayıtlı kural: 770/);
  });

  it("alışta KDV tevkifatı: KDV tamamı indirilir, tevkif edilen kısım 360'a, satıcıya kalan ödenir", () => {
    const p = proposeEntry(invoice({ withholdingTotal: d("100.00"), payableAmount: d("1100.00") }), { roles: ROLES });
    expect(summary(p)).toEqual(["153 B 1000.00", "191 B 200.00", "320 A 1100.00", "360 A 100.00"]);
    expect(p.totalDebit.toFixed(2)).toBe("1200.00");
  });

  it("satışta tevkifat: hesaplanan KDV tevkifat düşülerek, alıcıdan ödenecek tutar", () => {
    const p = proposeEntry(invoice({ direction: "SALE", withholdingTotal: d("100.00"), payableAmount: d("1100.00") }), { roles: ROLES });
    expect(summary(p)).toEqual(["120 B 1100.00", "600 A 1000.00", "391 A 100.00"]);
    expect(p.totalDebit.eq(p.totalCredit)).toBe(true);
  });

  it("KDV'siz (istisna) fatura: KDV satırı oluşmaz", () => {
    const p = proposeEntry(invoice({ taxes: [vat("0.00", "0")], payableAmount: d("1000.00") }), { roles: ROLES });
    expect(summary(p)).toEqual(["153 B 1000.00", "320 A 1000.00"]);
  });

  it("alışta KDV dışı vergi (ÖTV) maliyete eklenir ve uyarı verilir", () => {
    const otv = { taxTypeCode: "0071", taxName: "ÖTV", rate: null, taxAmount: d("50.00"), isWithholding: false };
    const p = proposeEntry(invoice({ taxes: [vat("200.00"), otv], payableAmount: d("1250.00") }), { roles: ROLES });
    expect(summary(p)).toEqual(["153 B 1000.00", "191 B 200.00", "153 B 50.00", "320 A 1250.00"]);
    expect(p.findings.map((f) => f.code)).toEqual(["OTHER_TAX"]);
  });

  it("iade (müşterimiz bize iade faturası kesti): satıştan iadeler B, hesaplanan KDV B — alıcılar A", () => {
    const p = proposeEntry(invoice({ direction: "PURCHASE", invoiceTypeCode: "IADE" }), { roles: ROLES });
    expect(summary(p)).toEqual(["610 B 1000.00", "391 B 200.00", "120 A 1200.00"]);
    expect(p.findings.map((f) => f.code)).toContain("RETURN_INVOICE");
  });

  it("iade (satıcımıza iade faturası kestik): satıcılar B — mal A, indirilecek KDV A", () => {
    const p = proposeEntry(invoice({ direction: "SALE", invoiceTypeCode: "IADE" }), { roles: ROLES });
    expect(summary(p)).toEqual(["320 B 1200.00", "153 A 1000.00", "191 A 200.00"]);
  });

  it("döviz: faturadaki kurla TL'ye çevrilir; kur yoksa hata", () => {
    const usd = invoice({ currency: "USD", exchangeRate: d("32.5"), taxExclusiveAmount: d("100.00"), taxes: [vat("20.00")], payableAmount: d("120.00") });
    expect(summary(proposeEntry(usd, { roles: ROLES }))).toEqual(["153 B 3250.00", "191 B 650.00", "320 A 3900.00"]);
    const noRate = proposeEntry({ ...usd, exchangeRate: null }, { roles: ROLES });
    expect(noRate.findings.map((f) => f.code)).toContain("EXCHANGE_RATE_MISSING");
  });

  it("fatura toplamları tutarsızsa fiş dengesiz olarak işaretlenir (otomatik kapatılmaz)", () => {
    const p = proposeEntry(invoice({ payableAmount: d("1500.00") }), { roles: ROLES });
    expect(p.findings.find((f) => f.code === "IMBALANCED")?.message).toMatch(/fark 300.00/);
  });
});
