import type { DocumentFormat, DocumentStatus, InvoiceDirection } from "@prisma/client";

/** Belge durumlarının ekrandaki karşılıkları (sunucu ve istemci ortak). */
export const STATUS_LABELS: Readonly<Record<DocumentStatus, string>> = {
  UPLOADED: "Yüklendi",
  VALIDATING: "Doğrulanıyor",
  QUEUED: "Sırada",
  CLASSIFYING: "Sınıflandırılıyor",
  EXTRACTING: "Okunuyor",
  OCR_PROCESSING: "OCR",
  AI_PROCESSING: "Yapay zekâ",
  VALIDATION_REQUIRED: "Düzeltme gerekli",
  ACCOUNTING_PENDING: "Muhasebeleşmeyi bekliyor",
  NEEDS_REVIEW: "Kontrol bekliyor",
  APPROVED: "Onaylandı",
  EXPORT_PENDING: "Aktarıma hazır",
  EXPORTING: "Aktarılıyor",
  EXPORTED: "Aktarıldı",
  FAILED: "İşlenemedi",
  DUPLICATE: "Mükerrer",
  REJECTED: "Reddedildi",
  ARCHIVED: "Arşivde",
};

export type StatusTone = "neutral" | "good" | "warning" | "critical" | "brand";

export const STATUS_TONES: Readonly<Record<DocumentStatus, StatusTone>> = {
  UPLOADED: "neutral",
  VALIDATING: "neutral",
  QUEUED: "neutral",
  CLASSIFYING: "neutral",
  EXTRACTING: "neutral",
  OCR_PROCESSING: "neutral",
  AI_PROCESSING: "neutral",
  VALIDATION_REQUIRED: "warning",
  NEEDS_REVIEW: "brand",
  ACCOUNTING_PENDING: "good",
  APPROVED: "good",
  EXPORT_PENDING: "good",
  EXPORTING: "good",
  EXPORTED: "good",
  FAILED: "critical",
  DUPLICATE: "neutral",
  REJECTED: "critical",
  ARCHIVED: "neutral",
};

/** İşlemde olan (kullanıcı beklemesi gereken) durumlar. */
export const PROCESSING_STATUSES: readonly DocumentStatus[] = ["UPLOADED", "VALIDATING", "QUEUED", "CLASSIFYING", "EXTRACTING", "OCR_PROCESSING", "AI_PROCESSING"];

export const DIRECTION_LABELS: Readonly<Record<InvoiceDirection, string>> = { PURCHASE: "Alış", SALE: "Satış" };

export const FORMAT_LABELS: Readonly<Record<DocumentFormat, string>> = {
  XML: "XML",
  PDF: "PDF",
  IMAGE: "Görsel",
  SPREADSHEET: "Excel",
  CSV: "CSV",
  ZIP: "ZIP",
  OTHER: "Diğer",
};

export const FIELD_LABELS: Readonly<Record<string, string>> = {
  ettn: "ETTN",
  invoiceNo: "Fatura no",
  issueDate: "Fatura tarihi",
  profileId: "Senaryo",
  invoiceTypeCode: "Fatura tipi",
  currency: "Para birimi",
  supplierTaxId: "Satıcı VKN/TCKN",
  supplierName: "Satıcı",
  customerTaxId: "Alıcı VKN/TCKN",
  customerName: "Alıcı",
  lineExtension: "Mal/hizmet toplamı",
  taxExclusive: "Vergiler hariç",
  taxInclusive: "Vergiler dahil",
  payable: "Ödenecek tutar",
  iban: "IBAN",
};

/** e-Faturada sık kullanılan UN/ECE Rec. 20 birim kodları; bilinmeyen kod olduğu gibi gösterilir. */
export const UNIT_LABELS: Readonly<Record<string, string>> = {
  C62: "Adet",
  NIU: "Adet",
  KGM: "kg",
  GRM: "g",
  TNE: "ton",
  LTR: "lt",
  MTR: "m",
  MTK: "m²",
  MTQ: "m³",
  KWH: "kWh",
  HUR: "saat",
  DAY: "gün",
  MON: "ay",
  BX: "kutu",
  PA: "paket",
  SET: "set",
};

export const unitLabel = (code: string | null | undefined) => (code ? (UNIT_LABELS[code] ?? code) : "");
