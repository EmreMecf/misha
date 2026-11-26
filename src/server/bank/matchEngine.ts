import type { InvoiceDirection } from "@prisma/client";
import Decimal from "decimal.js";

/**
 * Banka hareketi → fatura / hesap önerisi (saf fonksiyon).
 * 1) Fatura eşleşmesi: tutar faturanın ödenecek tutarına birebir eşit olmalı (zorunlu); açıklamadaki
 *    fatura no, VKN/TCKN, karşı taraf adı ve tarih yakınlığı puan ekler. Her puanın gerekçesi yazılır.
 * 2) Fatura yoksa açıklama anahtar kelimesi kuralı (en uzun eşleşen kelime).
 * Öneri otomatik uygulanmaz; kullanıcı onaylar.
 */

export interface TxInput {
  amount: Decimal; // + giriş, − çıkış
  txDate: Date;
  description: string;
}

export interface InvoiceCandidate {
  documentId: string;
  direction: InvoiceDirection;
  invoiceNo: string;
  issueDate: Date;
  payable: Decimal;
  counterpartyTaxId: string | null;
  counterpartyName: string | null;
}

export interface RuleCandidate {
  id: string;
  keyword: string;
  direction: "IN" | "OUT" | "ANY";
  account: { id: string; code: string; name: string };
}

export type Suggestion =
  | {
      kind: "INVOICE";
      documentId: string;
      invoiceNo: string;
      counterpartyName: string | null;
      score: number;
      confidence: "high" | "medium" | "low";
      ambiguous: boolean;
      reasons: string[];
    }
  | { kind: "RULE"; ruleId: string; account: RuleCandidate["account"]; reasons: string[] };

const STOPWORDS = new Set([
  "LTD", "STI", "SIRKETI", "LIMITED", "ANONIM", "TICARET", "SANAYI", "INSAAT", "PAZARLAMA", "TURIZM", "GIDA", "TEKSTIL",
  "HIZMETLERI", "HIZMET", "DIS", "VE", "ITHALAT", "IHRACAT", "URUNLERI", "TIC", "SAN", "AS", "EFT", "HAVALE", "FAST",
  "ODEME", "FATURA", "BEDELI",
]);

/** Büyük harf, Türkçe karakterler ASCII'ye; harf/rakam dışı boşluk */
export function normalizeText(s: string) {
  return s
    .toLocaleUpperCase("tr")
    .replace(/İ/g, "I")
    .replace(/I/g, "I")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "I")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

export const nameTokens = (name: string) => normalizeText(name).split(" ").filter((t) => t.length >= 4 && !STOPWORDS.has(t) && !/^\d+$/.test(t));

const trMoney = (d: Decimal) => {
  const [i, f] = d.abs().toFixed(2).split(".");
  return `${i.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${f}`;
};
const DAY = 86_400_000;

function scoreInvoice(tx: TxInput, inv: InvoiceCandidate, desc: string, digits: string) {
  const reasons = [`Tutar faturanın ödenecek tutarına eşit (${trMoney(inv.payable)} TL)`];
  let score = 0;
  if (inv.invoiceNo && desc.includes(normalizeText(inv.invoiceNo))) {
    score += 3;
    reasons.push(`Açıklamada fatura no ${inv.invoiceNo} geçiyor`);
  }
  if (inv.counterpartyTaxId && digits.includes(inv.counterpartyTaxId)) {
    score += 3;
    reasons.push(`Açıklamada VKN/TCKN ${inv.counterpartyTaxId} geçiyor`);
  }
  const tokens = inv.counterpartyName ? nameTokens(inv.counterpartyName).filter((t) => desc.split(" ").includes(t)) : [];
  if (tokens.length > 0) {
    score += tokens.length >= 2 ? 3 : 2;
    reasons.push(`Açıklamada karşı taraf adı geçiyor (${tokens.join(", ")})`);
  }
  const days = Math.round((tx.txDate.getTime() - inv.issueDate.getTime()) / DAY);
  if (days >= 0 && days <= 120) {
    score += 1;
    reasons.push(days === 0 ? "Fatura ile aynı gün" : `Fatura tarihinden ${days} gün sonra`);
  } else if (days < 0) {
    score -= 2;
    reasons.push(`Hareket fatura tarihinden ${-days} gün önce (avans olabilir)`);
  }
  return { score, reasons };
}

export function suggest(tx: TxInput, invoices: InvoiceCandidate[], rules: RuleCandidate[]): Suggestion | null {
  const desc = normalizeText(tx.description);
  const digits = tx.description.replace(/\D+/g, " ");
  const direction: InvoiceDirection = tx.amount.isNegative() ? "PURCHASE" : "SALE";
  const amount = tx.amount.abs();

  const sameAmount = invoices.filter((i) => i.direction === direction && i.payable.eq(amount));
  if (sameAmount.length > 0) {
    const scored = sameAmount.map((inv) => ({ inv, ...scoreInvoice(tx, inv, desc, digits) })).sort((a, b) => b.score - a.score);
    const [best, second] = scored;
    const unique = scored.length === 1;
    // Zayıf sinyal ancak bu tutarda tek fatura varsa önerilir
    if (best.score >= 2 || (unique && best.score >= 0)) {
      if (unique) best.reasons.push("Bu tutarda eşleşmemiş başka fatura yok");
      return {
        kind: "INVOICE",
        documentId: best.inv.documentId,
        invoiceNo: best.inv.invoiceNo,
        counterpartyName: best.inv.counterpartyName,
        score: best.score,
        confidence: best.score >= 4 ? "high" : best.score >= 2 ? "medium" : "low",
        ambiguous: !!second && second.score === best.score,
        reasons: second && second.score === best.score ? [...best.reasons, `Aynı puanda ${scored.filter((s) => s.score === best.score).length - 1} başka fatura var; kontrol edin`] : best.reasons,
      };
    }
  }

  const want = tx.amount.isNegative() ? "OUT" : "IN";
  const rule = rules
    .filter((r) => (r.direction === "ANY" || r.direction === want) && desc.includes(normalizeText(r.keyword)))
    .sort((a, b) => b.keyword.length - a.keyword.length)[0];
  if (rule) {
    return { kind: "RULE", ruleId: rule.id, account: rule.account, reasons: [`Açıklamada "${rule.keyword}" geçiyor → kayıtlı kural: ${rule.account.code} ${rule.account.name}`] };
  }
  return null;
}
