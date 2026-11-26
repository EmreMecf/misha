import Decimal from "decimal.js";
import { isValidTckn, isValidVkn } from "@/server/taxpayers/taxIds";
import type { ParsedUblInvoice } from "./ublParser";

/**
 * Ayrıştırılmış faturanın tutarlılık kontrolleri. Hata (error) belge kullanılmadan önce düzeltilmeli;
 * uyarı (warning) kontrolde gösterilir. Kuruş toleransı yalnızca yuvarlama içindir (her hesaplama
 * adımı 0,01): vergi oranı/sınırı değildir.
 */

export interface Finding {
  code: string;
  message: string;
  field?: string;
}

export interface ValidationResult {
  errors: Finding[];
  warnings: Finding[];
}

const CENT = new Decimal("0.01");
const money = (d: Decimal) => d.toFixed(2).replace(".", ",");

export function validateInvoice(invoice: ParsedUblInvoice): ValidationResult {
  const errors: Finding[] = [];
  const warnings: Finding[] = [];

  for (const [role, party] of [["Satıcı", invoice.supplier], ["Alıcı", invoice.customer]] as const) {
    if (!party.taxId) {
      warnings.push({ code: "PARTY_TAX_ID_MISSING", message: `${role} VKN/TCKN bilgisi yok`, field: role === "Satıcı" ? "supplierTaxId" : "customerTaxId" });
    } else if (!(party.taxId.length === 10 ? isValidVkn(party.taxId) : isValidTckn(party.taxId))) {
      warnings.push({ code: "PARTY_TAX_ID_CHECKSUM", message: `${role} kimlik numarası (${party.taxId}) kontrol basamağı tutmuyor`, field: role === "Satıcı" ? "supplierTaxId" : "customerTaxId" });
    }
  }

  if (invoice.lines.length === 0) errors.push({ code: "NO_LINES", message: "Faturada kalem yok" });

  // Kalem toplamı = LineExtensionAmount (kalem başına 1 kuruş yuvarlama payı)
  const lineSum = invoice.lines.reduce((s, l) => s.plus(l.lineAmount), new Decimal(0));
  const lineTolerance = CENT.times(Math.max(1, invoice.lines.length));
  if (lineSum.minus(invoice.totals.lineExtension).abs().gt(lineTolerance)) {
    warnings.push({ code: "LINE_SUM_MISMATCH", message: `Kalem toplamı ${money(lineSum)}, fatura mal/hizmet toplamı ${money(invoice.totals.lineExtension)}`, field: "lineExtension" });
  }

  // Her KDV alt toplamı: matrah × oran ≈ vergi
  const vat = invoice.taxes.filter((t) => !t.isWithholding && (t.code === "0015" || t.name.toUpperCase() === "KDV"));
  for (const t of vat) {
    if (!t.rate) {
      warnings.push({ code: "VAT_RATE_MISSING", message: "KDV alt toplamında oran yok" });
      continue;
    }
    const expected = t.taxable.times(t.rate).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    if (expected.minus(t.amount).abs().gt(lineTolerance)) {
      warnings.push({ code: "VAT_CALC_MISMATCH", message: `%${t.rate} KDV: matrah ${money(t.taxable)} × oran = ${money(expected)}, faturada ${money(t.amount)}` });
    }
  }

  // Vergiler dahil toplam = vergiler hariç + (tevkifat dışı) vergiler
  const nonWithholding = invoice.taxes.filter((t) => !t.isWithholding).reduce((s, t) => s.plus(t.amount), new Decimal(0));
  const expectedInclusive = invoice.totals.taxExclusive.plus(nonWithholding);
  if (expectedInclusive.minus(invoice.totals.taxInclusive).abs().gt(lineTolerance)) {
    warnings.push({ code: "TAX_INCLUSIVE_MISMATCH", message: `Vergiler hariç ${money(invoice.totals.taxExclusive)} + vergiler ${money(nonWithholding)} ≠ vergiler dahil ${money(invoice.totals.taxInclusive)}`, field: "taxInclusive" });
  }

  // Ödenecek = vergiler dahil − tevkifat
  const expectedPayable = invoice.totals.taxInclusive.minus(invoice.totals.withholdingTotal);
  if (expectedPayable.minus(invoice.totals.payable).abs().gt(lineTolerance)) {
    warnings.push({ code: "PAYABLE_MISMATCH", message: `Vergiler dahil ${money(invoice.totals.taxInclusive)} − tevkifat ${money(invoice.totals.withholdingTotal)} ≠ ödenecek ${money(invoice.totals.payable)}`, field: "payable" });
  }

  if (invoice.currency !== "TRY" && !invoice.exchangeRate) {
    errors.push({ code: "EXCHANGE_RATE_MISSING", message: `Döviz faturası (${invoice.currency}) ama kur bilgisi yok`, field: "currency" });
  }
  if (invoice.invoiceTypeCode.includes("IADE")) {
    warnings.push({ code: "RETURN_INVOICE", message: "İade faturası: muhasebeleştirmede ters kayıt gerekir", field: "invoiceTypeCode" });
  }
  if (invoice.totals.withholdingTotal.gt(0)) {
    warnings.push({ code: "WITHHOLDING_PRESENT", message: `KDV tevkifatı var (${money(invoice.totals.withholdingTotal)})` });
  }
  return { errors, warnings };
}

/** Faturanın mükellefe göre yönü: alıcı mükellefse alış, satıcı mükellefse satış; ikisi de değilse null. */
export function resolveDirection(invoice: ParsedUblInvoice, taxpayerTaxId: string): "PURCHASE" | "SALE" | null {
  if (invoice.customer.taxId === taxpayerTaxId) return "PURCHASE";
  if (invoice.supplier.taxId === taxpayerTaxId) return "SALE";
  return null;
}
