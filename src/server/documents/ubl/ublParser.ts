import Decimal from "decimal.js";
import { XMLParser } from "fast-xml-parser";

/**
 * GİB UBL-TR 1.2 e-Fatura / e-Arşiv ayrıştırıcısı. Tutarlar metin olarak okunur ve doğrudan Decimal'e
 * çevrilir (float yok). Belgede olmayan alan uydurulmaz: null döner.
 */

export const UBL_PARSER = { name: "ubl-tr", version: "1.0.0" } as const;

export class UblParseError extends Error {}

export interface Party {
  taxId: string | null;
  scheme: "VKN" | "TCKN" | null;
  name: string | null;
  taxOffice: string | null;
  street: string | null;
  district: string | null;
  city: string | null;
  country: string | null;
}

export interface TaxEntry {
  code: string | null;
  name: string;
  rate: Decimal | null;
  taxable: Decimal;
  amount: Decimal;
  isWithholding: boolean;
}

export interface InvoiceLineData {
  lineNo: number;
  name: string;
  stockCode: string | null;
  quantity: Decimal;
  unitCode: string | null;
  unitPrice: Decimal | null;
  discountAmount: Decimal;
  lineAmount: Decimal;
  vatRate: Decimal;
  vatAmount: Decimal;
}

export interface ParsedUblInvoice {
  ettn: string;
  invoiceNo: string;
  issueDate: string; // YYYY-MM-DD
  issueTime: string | null;
  profileId: string;
  invoiceTypeCode: string;
  currency: string;
  exchangeRate: Decimal | null;
  supplier: Party;
  customer: Party;
  lines: InvoiceLineData[];
  taxes: TaxEntry[];
  totals: {
    lineExtension: Decimal;
    allowanceTotal: Decimal;
    taxExclusive: Decimal;
    taxInclusive: Decimal;
    payable: Decimal;
    withholdingTotal: Decimal;
  };
  payment: { meansCode: string | null; iban: string | null; dueDate: string | null } | null;
  notes: string[];
  hasEmbeddedXslt: boolean;
}

export interface FieldInfo {
  value: string | null;
  source: string;
  method: "XML_PARSER";
  confidence: number;
}

const ALWAYS_ARRAY = new Set([
  "PartyIdentification",
  "TaxTotal",
  "TaxSubtotal",
  "WithholdingTaxTotal",
  "InvoiceLine",
  "Note",
  "PaymentMeans",
  "AllowanceCharge",
  "AdditionalDocumentReference",
]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => ALWAYS_ARRAY.has(name),
  processEntities: true,
});

type Node = Record<string, unknown>;
const node = (v: unknown): Node | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Node) : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined ? [] : [v]);

function text(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number") return String(v);
  const inner = node(v)?.["#text"];
  return inner === undefined ? null : String(inner).trim() || null;
}
const attr = (v: unknown, name: string) => {
  const a = node(v)?.[`@_${name}`];
  return a === undefined ? null : String(a).trim();
};

const DECIMAL = /^-?\d+(\.\d+)?$/;
function amount(v: unknown, field: string, required = false): Decimal {
  const raw = text(v);
  if (raw === null) {
    if (required) throw new UblParseError(`Zorunlu tutar eksik: ${field}`);
    return new Decimal(0);
  }
  if (!DECIMAL.test(raw)) throw new UblParseError(`${field} sayısal değil: "${raw.slice(0, 30)}"`);
  return new Decimal(raw);
}
const optionalDecimal = (v: unknown) => {
  const raw = text(v);
  return raw && DECIMAL.test(raw) ? new Decimal(raw) : null;
};

function parseParty(wrapper: unknown): Party {
  const party = node(node(wrapper)?.Party);
  const empty: Party = { taxId: null, scheme: null, name: null, taxOffice: null, street: null, district: null, city: null, country: null };
  if (!party) return empty;
  let taxId: string | null = null;
  let scheme: Party["scheme"] = null;
  for (const identification of arr(party.PartyIdentification)) {
    const id = node(identification)?.ID;
    const s = attr(id, "schemeID")?.toUpperCase();
    if (s === "VKN" || s === "TCKN") {
      taxId = text(id)?.replace(/\D/g, "") ?? null;
      scheme = s;
      break;
    }
  }
  const person = node(party.Person);
  const personName = person ? [text(person.FirstName), text(person.FamilyName)].filter(Boolean).join(" ") : "";
  const address = node(party.PostalAddress);
  const building = text(address?.BuildingNumber);
  const street = [text(address?.StreetName), building ? `No:${building}` : null].filter(Boolean).join(" ");
  return {
    taxId,
    scheme,
    name: text(node(party.PartyName)?.Name) ?? (personName || null),
    taxOffice: text(node(node(party.PartyTaxScheme)?.TaxScheme)?.Name),
    street: street || null,
    district: text(address?.CitySubdivisionName),
    city: text(address?.CityName),
    country: text(node(address?.Country)?.Name),
  };
}

const isVat = (subtotal: Node) => {
  const scheme = node(node(subtotal.TaxCategory)?.TaxScheme);
  return text(scheme?.TaxTypeCode) === "0015" || text(scheme?.Name)?.toUpperCase() === "KDV";
};

function parseTaxTotals(totals: unknown[], isWithholding: boolean, field: string): TaxEntry[] {
  const out: TaxEntry[] = [];
  for (const total of totals) {
    for (const sub of arr(node(total)?.TaxSubtotal)) {
      const s = node(sub);
      if (!s) continue;
      const scheme = node(node(s.TaxCategory)?.TaxScheme);
      const code = text(scheme?.TaxTypeCode);
      out.push({
        code,
        name: text(scheme?.Name) ?? (isVat(s) ? "KDV" : "Vergi"),
        rate: optionalDecimal(s.Percent) ?? optionalDecimal(node(s.TaxCategory)?.Percent),
        taxable: amount(s.TaxableAmount, `${field}/TaxableAmount`),
        amount: amount(s.TaxAmount, `${field}/TaxAmount`),
        isWithholding,
      });
    }
  }
  return out;
}

function parseLine(line: unknown, index: number): InvoiceLineData {
  const l = node(line) ?? {};
  const item = node(l.Item) ?? {};
  const field = `InvoiceLine[${index + 1}]`;
  let vatRate = new Decimal(0);
  let vatAmount = new Decimal(0);
  for (const total of arr(l.TaxTotal)) {
    for (const sub of arr(node(total)?.TaxSubtotal)) {
      const s = node(sub);
      if (!s || !isVat(s)) continue;
      vatRate = optionalDecimal(s.Percent) ?? optionalDecimal(node(s.TaxCategory)?.Percent) ?? vatRate;
      vatAmount = vatAmount.plus(amount(s.TaxAmount, `${field}/TaxAmount`));
    }
  }
  let discount = new Decimal(0);
  for (const ac of arr(l.AllowanceCharge)) {
    const a = node(ac);
    if (a && text(a.ChargeIndicator) !== "true") discount = discount.plus(amount(a.Amount, `${field}/AllowanceCharge`));
  }
  const id = (v: unknown) => text(node(v)?.ID);
  return {
    lineNo: index + 1,
    name: (text(item.Name) ?? text(item.Description) ?? "").slice(0, 500),
    stockCode: id(item.SellersItemIdentification) ?? id(item.BuyersItemIdentification),
    quantity: optionalDecimal(l.InvoicedQuantity) ?? new Decimal(0),
    unitCode: attr(l.InvoicedQuantity, "unitCode"),
    unitPrice: optionalDecimal(node(l.Price)?.PriceAmount),
    discountAmount: discount,
    lineAmount: amount(l.LineExtensionAmount, `${field}/LineExtensionAmount`, true),
    vatRate,
    vatAmount,
  };
}

const ETTN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** UBL faturası mı? (ayrıştırmadan önce hızlı kontrol; sınıflandırıcı kullanır) */
export function looksLikeUblInvoice(xml: string) {
  return /<(\w+:)?Invoice[\s>]/.test(xml.slice(0, 4000)) && xml.includes("urn:oasis:names:specification:ubl:schema:xsd:Invoice-2");
}

/** XML'i okur. UBL fatura değilse veya zorunlu alan eksikse UblParseError fırlatır. */
export function parseUblInvoice(input: string | Uint8Array): { invoice: ParsedUblInvoice; fields: Record<string, FieldInfo> } {
  const xml = (typeof input === "string" ? input : new TextDecoder("utf-8").decode(input)).replace(/^﻿/, "");
  // UBL DTD kullanmaz; DTD/varlık tanımı içeren belge dış varlık ve "billion laughs" saldırısına karşı reddedilir
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new UblParseError("XML'de DTD/varlık tanımı var; güvenlik nedeniyle işlenmedi");

  let doc: Node;
  try {
    doc = parser.parse(xml) as Node;
  } catch (error) {
    throw new UblParseError(`XML okunamadı: ${error instanceof Error ? error.message.slice(0, 200) : "bilinmeyen hata"}`);
  }
  const inv = node(doc.Invoice);
  if (!inv) throw new UblParseError("UBL fatura değil (kök eleman Invoice değil)");

  const required = (v: unknown, f: string) => {
    const t = text(v);
    if (!t) throw new UblParseError(`Zorunlu alan eksik: ${f}`);
    return t;
  };
  const ettn = required(inv.UUID, "UUID (ETTN)").toLowerCase();
  if (!ETTN.test(ettn)) throw new UblParseError(`ETTN biçimi geçersiz: ${ettn.slice(0, 40)}`);
  const issueDate = required(inv.IssueDate, "IssueDate");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate) || Number.isNaN(Date.parse(`${issueDate}T00:00:00Z`))) {
    throw new UblParseError(`Fatura tarihi geçersiz: ${issueDate}`);
  }
  const monetary = node(inv.LegalMonetaryTotal);
  if (!monetary) throw new UblParseError("Zorunlu alan eksik: LegalMonetaryTotal");

  const taxes = [...parseTaxTotals(arr(inv.TaxTotal), false, "TaxTotal"), ...parseTaxTotals(arr(inv.WithholdingTaxTotal), true, "WithholdingTaxTotal")];
  const firstPayment = node(arr(inv.PaymentMeans)[0]);
  const exchange = node(inv.PricingExchangeRate);
  const hasEmbeddedXslt = arr(inv.AdditionalDocumentReference).some((r) => {
    const obj = node(node(r)?.Attachment)?.EmbeddedDocumentBinaryObject;
    return /\.xslt?$/i.test(attr(obj, "filename") ?? "") || text(node(r)?.DocumentType)?.toUpperCase() === "XSLT";
  });

  const invoice: ParsedUblInvoice = {
    ettn,
    invoiceNo: required(inv.ID, "ID (fatura no)").slice(0, 50),
    issueDate,
    issueTime: text(inv.IssueTime),
    profileId: (text(inv.ProfileID) ?? "TEMELFATURA").toUpperCase(),
    invoiceTypeCode: (text(inv.InvoiceTypeCode) ?? "SATIS").toUpperCase(),
    currency: (text(inv.DocumentCurrencyCode) ?? "TRY").toUpperCase(),
    exchangeRate: optionalDecimal(exchange?.CalculationRate),
    supplier: parseParty(inv.AccountingSupplierParty),
    customer: parseParty(inv.AccountingCustomerParty),
    lines: arr(inv.InvoiceLine).map(parseLine),
    taxes,
    totals: {
      lineExtension: amount(monetary.LineExtensionAmount, "LineExtensionAmount", true),
      allowanceTotal: amount(monetary.AllowanceTotalAmount, "AllowanceTotalAmount"),
      taxExclusive: amount(monetary.TaxExclusiveAmount, "TaxExclusiveAmount", true),
      taxInclusive: amount(monetary.TaxInclusiveAmount, "TaxInclusiveAmount", true),
      payable: amount(monetary.PayableAmount, "PayableAmount", true),
      withholdingTotal: taxes.filter((t) => t.isWithholding).reduce((s, t) => s.plus(t.amount), new Decimal(0)),
    },
    payment: firstPayment
      ? { meansCode: text(firstPayment.PaymentMeansCode), iban: text(node(firstPayment.PayeeFinancialAccount)?.ID), dueDate: text(firstPayment.PaymentDueDate) }
      : null,
    notes: arr(inv.Note).map(text).filter((n): n is string => !!n).slice(0, 20),
    hasEmbeddedXslt,
  };

  const f = (value: string | null | undefined, source: string): FieldInfo => ({ value: value ?? null, source, method: "XML_PARSER", confidence: value ? 1 : 0 });
  const fields: Record<string, FieldInfo> = {
    ettn: f(invoice.ettn, "/Invoice/cbc:UUID"),
    invoiceNo: f(invoice.invoiceNo, "/Invoice/cbc:ID"),
    issueDate: f(invoice.issueDate, "/Invoice/cbc:IssueDate"),
    profileId: f(invoice.profileId, "/Invoice/cbc:ProfileID"),
    invoiceTypeCode: f(invoice.invoiceTypeCode, "/Invoice/cbc:InvoiceTypeCode"),
    currency: f(invoice.currency, "/Invoice/cbc:DocumentCurrencyCode"),
    supplierTaxId: f(invoice.supplier.taxId, "/Invoice/cac:AccountingSupplierParty/cac:Party/cac:PartyIdentification/cbc:ID"),
    supplierName: f(invoice.supplier.name, "/Invoice/cac:AccountingSupplierParty/cac:Party/cac:PartyName/cbc:Name"),
    customerTaxId: f(invoice.customer.taxId, "/Invoice/cac:AccountingCustomerParty/cac:Party/cac:PartyIdentification/cbc:ID"),
    customerName: f(invoice.customer.name, "/Invoice/cac:AccountingCustomerParty/cac:Party/cac:PartyName/cbc:Name"),
    lineExtension: f(invoice.totals.lineExtension.toFixed(2), "/Invoice/cac:LegalMonetaryTotal/cbc:LineExtensionAmount"),
    taxExclusive: f(invoice.totals.taxExclusive.toFixed(2), "/Invoice/cac:LegalMonetaryTotal/cbc:TaxExclusiveAmount"),
    taxInclusive: f(invoice.totals.taxInclusive.toFixed(2), "/Invoice/cac:LegalMonetaryTotal/cbc:TaxInclusiveAmount"),
    payable: f(invoice.totals.payable.toFixed(2), "/Invoice/cac:LegalMonetaryTotal/cbc:PayableAmount"),
    iban: f(invoice.payment?.iban, "/Invoice/cac:PaymentMeans/cac:PayeeFinancialAccount/cbc:ID"),
  };
  return { invoice, fields };
}
