import type { AccountRole, InvoiceDirection } from "@prisma/client";
import Decimal from "decimal.js";

/**
 * Faturadan muhasebe fişi önerisi (saf fonksiyon; veritabanına dokunmaz).
 *
 * Karar önceliği (ACCOUNTING_ENGINE.md): 1) mükellefe özel kesin kural (karşı taraf + yön),
 * 4) aynı karşı tarafın geçmiş onaylı fişleri, 7) deterministik rol eşlemesi. AI ve benzer belge
 * katmanları sonraki fazlarda eklenir. Her satır kaynağını ve gerekçesini taşır; tutarlar Decimal.
 *
 * Kayıt şablonları (muhasebeci kontrolü ve onayı olmadan kesinleşmez):
 *  Alış:  MAIN B / İndirilecek KDV B / diğer vergiler B (maliyete) — Satıcılar A (ödenecek) / tevkifat A
 *  Satış: Alıcılar B (ödenecek) — MAIN A / Hesaplanan KDV A (KDV − tevkifat) / diğer vergiler A (hesap seçilir)
 *  İade faturaları ilgili şablonun ters yönüdür (bkz. buildLayout).
 */

export interface AccountRef {
  id: string;
  code: string;
  name: string;
}

export interface ProposalTax {
  taxTypeCode: string | null;
  taxName: string;
  rate: Decimal | null;
  taxAmount: Decimal;
  isWithholding: boolean;
}

export interface ProposalInvoice {
  direction: InvoiceDirection;
  invoiceTypeCode: string;
  invoiceNo: string;
  currency: string;
  exchangeRate: Decimal | null;
  taxExclusiveAmount: Decimal;
  withholdingTotal: Decimal;
  payableAmount: Decimal;
  taxes: ProposalTax[];
  counterpartyTaxId: string | null;
  counterpartyName: string | null;
}

export interface ProposalContext {
  roles: Partial<Record<AccountRole, AccountRef>>;
  /** Mükellefe özel kesin kural (karşı taraf + yön) */
  rule?: AccountRef | null;
  /** Aynı karşı tarafın geçmiş kesin fişlerinde ana satırın en sık hesabı */
  history?: { account: AccountRef; count: number } | null;
}

export type LineKind = "MAIN" | "VAT" | "COUNTERPARTY" | "WITHHOLDING" | "OTHER_TAX";
export type LineSource = "POSTING_RULE" | "HISTORY" | "ROLE_MAPPING" | "UNRESOLVED";

export interface ProposedLine {
  kind: LineKind;
  debit: Decimal;
  credit: Decimal;
  accountId: string | null;
  description: string;
  source: LineSource;
  reason: string;
}

export interface Finding {
  code: string;
  severity: "error" | "warning";
  message: string;
}

export interface Proposal {
  lines: ProposedLine[];
  findings: Finding[];
  description: string;
  totalDebit: Decimal;
  totalCredit: Decimal;
}

const VAT_CODE = "0015";
const ZERO = new Decimal(0);
const label = (a: AccountRef) => `${a.code} ${a.name}`;

const ROLE_NAMES: Record<AccountRole, string> = {
  PURCHASE_DEFAULT: "Alış varsayılan hesabı",
  INPUT_VAT: "İndirilecek KDV",
  SUPPLIER: "Satıcılar",
  VAT_WITHHOLDING: "KDV tevkifatı",
  SALES_REVENUE: "Satış geliri",
  OUTPUT_VAT: "Hesaplanan KDV",
  CUSTOMER: "Alıcılar",
  SALES_RETURN: "Satıştan iadeler",
};

interface Resolved {
  account: AccountRef | null;
  source: LineSource;
  reason: string;
}

function byRole(ctx: ProposalContext, role: AccountRole): Resolved {
  const account = ctx.roles[role];
  return account
    ? { account, source: "ROLE_MAPPING", reason: `Hesap rolü: ${ROLE_NAMES[role]} → ${label(account)}` }
    : { account: null, source: "UNRESOLVED", reason: `"${ROLE_NAMES[role]}" rolüne hesap atanmamış; hesabı seçin veya hesap planından rolü tanımlayın` };
}

/** Ana satır (gider/gelir): kesin kural → geçmiş onaylar → rol eşlemesi. */
function resolveMain(ctx: ProposalContext, role: AccountRole, counterparty: string): Resolved {
  if (ctx.rule) return { account: ctx.rule, source: "POSTING_RULE", reason: `${counterparty} için kayıtlı kural: ${label(ctx.rule)}` };
  if (ctx.history && ctx.history.count > 0) {
    return {
      account: ctx.history.account,
      source: "HISTORY",
      reason: `${counterparty} ile ilgili onaylanmış ${ctx.history.count} fişte ana satır ${label(ctx.history.account)} hesabına işlendi`,
    };
  }
  return byRole(ctx, role);
}

const isReturn = (typeCode: string) => typeCode.toUpperCase() === "IADE";

export function proposeEntry(invoice: ProposalInvoice, ctx: ProposalContext): Proposal {
  const findings: Finding[] = [];
  const counterparty = invoice.counterpartyName ?? invoice.counterpartyTaxId ?? "Karşı taraf";

  // Döviz: tutarlar TL'ye çevrilir (kur faturadaki kurdur); kur yoksa fiş kesinleşemez
  let rate = new Decimal(1);
  if (invoice.currency !== "TRY") {
    if (!invoice.exchangeRate || invoice.exchangeRate.lte(0)) {
      findings.push({ code: "EXCHANGE_RATE_MISSING", severity: "error", message: `${invoice.currency} faturasında döviz kuru yok; TL karşılığı hesaplanamadı` });
    } else {
      rate = invoice.exchangeRate;
      findings.push({ code: "FOREIGN_CURRENCY", severity: "warning", message: `Tutarlar faturadaki ${invoice.exchangeRate.toString()} kuruyla TL'ye çevrildi` });
    }
  }
  const tl = (v: Decimal) => v.mul(rate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  const vat = invoice.taxes.filter((t) => !t.isWithholding && t.taxTypeCode === VAT_CODE).reduce((s, t) => s.plus(t.taxAmount), ZERO);
  const otherTaxes = invoice.taxes.filter((t) => !t.isWithholding && t.taxTypeCode !== VAT_CODE && t.taxAmount.gt(0));
  const withholding = invoice.withholdingTotal;

  const lines: ProposedLine[] = [];
  const push = (kind: LineKind, side: "D" | "C", amount: Decimal, r: Resolved, description: string) => {
    const value = tl(amount);
    if (value.lte(0)) return;
    lines.push({
      kind,
      debit: side === "D" ? value : ZERO,
      credit: side === "C" ? value : ZERO,
      accountId: r.account?.id ?? null,
      description: description.slice(0, 300),
      source: r.source,
      reason: r.reason.slice(0, 500),
    });
  };

  const ret = isReturn(invoice.invoiceTypeCode);
  // Alış şablonu: normal alış veya mükellefin satıcısına kestiği iade faturası (SALE + IADE)
  const purchaseLayout = (invoice.direction === "PURCHASE") !== ret;
  // İade faturasında taraflar ters çalışır
  const D: "D" | "C" = ret ? "C" : "D";
  const C: "D" | "C" = ret ? "D" : "C";

  if (purchaseLayout) {
    const main = resolveMain(ctx, "PURCHASE_DEFAULT", counterparty);
    push("MAIN", D, invoice.taxExclusiveAmount, main, ret ? "İade edilen mal/hizmet" : "Mal/hizmet alışı");
    push("VAT", D, vat, byRole(ctx, "INPUT_VAT"), "KDV");
    for (const t of otherTaxes) {
      // Alışta KDV dışındaki vergiler (ör. ÖTV) maliyete eklenir — ana satırın hesabına
      push("OTHER_TAX", D, t.taxAmount, { ...main, reason: `${t.taxName} maliyete eklendi (ana satırın hesabı)` }, t.taxName);
      findings.push({ code: "OTHER_TAX", severity: "warning", message: `${t.taxName} (${t.taxTypeCode ?? "kodsuz"}) maliyete eklendi; işletmenize uygunluğunu kontrol edin` });
    }
    push("COUNTERPARTY", C, invoice.payableAmount, byRole(ctx, "SUPPLIER"), counterparty);
    push("WITHHOLDING", C, withholding, byRole(ctx, "VAT_WITHHOLDING"), "KDV tevkifatı (sorumlu sıfatıyla)");
  } else {
    const mainRole: AccountRole = ret ? "SALES_RETURN" : "SALES_REVENUE";
    // Satış tarafında mükellef KDV'nin tevkif edilmeyen kısmını beyan eder
    push("COUNTERPARTY", D, invoice.payableAmount, byRole(ctx, "CUSTOMER"), counterparty);
    push("MAIN", C, invoice.taxExclusiveAmount, ret ? byRole(ctx, mainRole) : resolveMain(ctx, mainRole, counterparty), ret ? "Satıştan iade" : "Mal/hizmet satışı");
    push("VAT", C, vat.minus(withholding), byRole(ctx, "OUTPUT_VAT"), withholding.gt(0) ? "KDV (tevkifat düşülmüş)" : "KDV");
    for (const t of otherTaxes) {
      push("OTHER_TAX", C, t.taxAmount, { account: null, source: "UNRESOLVED", reason: `${t.taxName} için hesap seçin (ör. 360)` }, t.taxName);
      findings.push({ code: "OTHER_TAX", severity: "warning", message: `${t.taxName} satırının hesabını seçin` });
    }
    if (withholding.gt(vat)) {
      findings.push({ code: "WITHHOLDING_EXCEEDS_VAT", severity: "error", message: "Tevkifat tutarı KDV'den büyük; fatura verisi tutarsız" });
    }
  }

  // İade faturası kaydını ters şablonla kurduk ama satır sıralaması anlaşılır kalsın: önce borçlar
  if (ret) {
    lines.sort((a, b) => Number(b.debit.gt(0)) - Number(a.debit.gt(0)));
    findings.push({ code: "RETURN_INVOICE", severity: "warning", message: "İade faturası: kayıt ters yönde oluşturuldu, hesapları kontrol edin" });
  }

  const totalDebit = lines.reduce((s, l) => s.plus(l.debit), ZERO);
  const totalCredit = lines.reduce((s, l) => s.plus(l.credit), ZERO);
  if (!totalDebit.eq(totalCredit)) {
    findings.push({
      code: "IMBALANCED",
      severity: "error",
      message: `Fiş dengesiz: borç ${totalDebit.toFixed(2)}, alacak ${totalCredit.toFixed(2)} (fark ${totalDebit.minus(totalCredit).abs().toFixed(2)}). Fatura toplamları veya kur yuvarlaması tutarsız; satırları kontrol edin`,
    });
  }
  const unresolved = lines.filter((l) => !l.accountId).length;
  if (unresolved > 0) findings.push({ code: "ACCOUNT_MISSING", severity: "error", message: `${unresolved} satırın hesabı seçilmeli` });

  const kind = invoice.direction === "PURCHASE" ? (ret ? "iade (alıcıdan)" : "alış") : ret ? "iade (satıcıya)" : "satış";
  return {
    lines: lines.map((l, i) => ({ ...l, lineNo: i + 1 })),
    findings,
    description: `${invoice.invoiceNo} nolu ${kind} faturası — ${counterparty}`.slice(0, 500),
    totalDebit,
    totalCredit,
  };
}
