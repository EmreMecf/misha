import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import { XMLParser } from "fast-xml-parser";
import { unzipSync } from "fflate";

/**
 * Banka ekstresi ayrıştırıcı (saf; veritabanına dokunmaz).
 * Belirli bir bankaya özel değildir: başlık satırını ve sütunları eş anlamlı adlardan tahmin eder,
 * kullanıcı önizlemede eşlemeyi düzeltir. Örnek ekstresi doğrulanmamış banka "destekleniyor" sayılmaz.
 */

export const STATEMENT_LIMITS = { maxBytes: 5 * 1024 * 1024, maxRows: 10_000, maxXlsxUncompressed: 50 * 1024 * 1024 } as const;

export class StatementError extends Error {}

export type StatementFormat = "CSV" | "XLSX";
export type Table = string[][];

// ---------------------------------------------------------------- dosya → tablo

export function sniffStatement(name: string, data: Uint8Array): StatementFormat {
  if (data.length === 0) throw new StatementError("Dosya boş");
  if (data.length > STATEMENT_LIMITS.maxBytes) throw new StatementError("Ekstre dosyası en fazla 5 MB olabilir");
  const ext = name.toLowerCase().split(".").pop();
  const isZip = data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04;
  if (ext === "xlsx" && isZip) return "XLSX";
  if (ext === "csv" || ext === "txt") {
    if (isZip || data.subarray(0, 512).includes(0)) throw new StatementError("CSV dosyası metin değil");
    return "CSV";
  }
  if (ext === "xls") throw new StatementError("Eski Excel (.xls) okunamıyor; dosyayı .xlsx veya .csv olarak kaydedin");
  if (ext === "pdf") throw new StatementError("PDF ekstre okuma geliştirme aşamasında; bankadan Excel/CSV indirin");
  throw new StatementError("Desteklenen biçimler: .xlsx, .csv");
}

/** UTF-8 (BOM'lu/BOM'suz); geçersiz UTF-8 ise Türkçe Windows kod sayfası (1254). */
export function decodeText(data: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1254").decode(data);
  }
}

export function parseCsv(text: string): Table {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const counts = [";", ",", "\t"].map((d) => [d, firstLine.split(d).length - 1] as const);
  const delimiter = counts.sort((a, b) => b[1] - a[1])[0][0];
  const rows: Table = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === delimiter) {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell.trim());
      // Boş satırlar da tutulur: satır numaraları dosyadaki gerçek satırla aynı kalsın
      rows.push(row.some((c) => c !== "") ? row : []);
      row = [];
      cell = "";
      if (rows.length > STATEMENT_LIMITS.maxRows + 50) throw new StatementError(`Ekstre en fazla ${STATEMENT_LIMITS.maxRows} satır olabilir`);
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some((c) => c !== "")) rows.push(row);
  return rows;
}

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", processEntities: true, parseTagValue: false, trimValues: false });
const arr = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const textOf = (node: unknown): string => {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (typeof node === "object") {
    const o = node as Record<string, unknown>;
    if ("#text" in o) return String(o["#text"]);
    // Zengin metin: <si><r><t>..</t></r>...</si>
    return [...arr(o.t as unknown), ...arr(o.r as unknown).map((r) => (r as Record<string, unknown>).t)].map(textOf).join("");
  }
  return "";
};

/** XLSX'in ilk çalışma sayfasını tabloya çevirir. Sayısal hücreler ham (noktalı) metin olarak döner. */
export function parseXlsx(data: Uint8Array): Table {
  let total = 0;
  const files = unzipSync(data, {
    filter: (f) => {
      total += f.originalSize;
      if (total > STATEMENT_LIMITS.maxXlsxUncompressed) throw new StatementError("Excel dosyası çok büyük");
      return f.name === "xl/workbook.xml" || f.name === "xl/_rels/workbook.xml.rels" || f.name === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(f.name);
    },
  });
  const read = (n: string) => (files[n] ? new TextDecoder().decode(files[n]) : null);
  const reject = (s: string | null) => {
    if (s && /<!DOCTYPE|<!ENTITY/i.test(s)) throw new StatementError("Excel dosyası güvenlik nedeniyle reddedildi (DTD)");
    return s;
  };

  const workbook = reject(read("xl/workbook.xml"));
  const rels = reject(read("xl/_rels/workbook.xml.rels"));
  let sheetPath = "xl/worksheets/sheet1.xml";
  if (workbook && rels) {
    const firstSheet = arr(xml.parse(workbook)?.workbook?.sheets?.sheet)[0] as Record<string, string> | undefined;
    const rid = firstSheet?.["@r:id"];
    const rel = arr(xml.parse(rels)?.Relationships?.Relationship).find((r) => (r as Record<string, string>)["@Id"] === rid) as Record<string, string> | undefined;
    if (rel?.["@Target"]) sheetPath = `xl/${rel["@Target"].replace(/^\/?xl\//, "").replace(/^\//, "")}`;
  }
  const sheet = reject(read(sheetPath));
  if (!sheet) throw new StatementError("Excel dosyasında çalışma sayfası bulunamadı");
  const sharedXml = reject(read("xl/sharedStrings.xml"));
  const shared = sharedXml ? arr(xml.parse(sharedXml)?.sst?.si).map(textOf) : [];

  const colIndex = (ref: string) => {
    const letters = ref.replace(/\d+/g, "");
    let n = 0;
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  };
  const rows: Table = [];
  for (const r of arr(xml.parse(sheet)?.worksheet?.sheetData?.row)) {
    const row: string[] = [];
    for (const c of arr((r as Record<string, unknown>).c) as Array<Record<string, unknown>>) {
      const idx = colIndex(String(c["@r"] ?? ""));
      const type = c["@t"];
      let value = "";
      if (type === "s") value = shared[Number(textOf(c.v))] ?? "";
      else if (type === "inlineStr") value = textOf((c.is as Record<string, unknown>) ?? "");
      else value = textOf(c.v);
      if (idx >= 0 && idx < 200) row[idx] = value.trim();
    }
    const filled = Array.from(row, (v) => v ?? "");
    // Satırın Excel'deki numarasına yerleştir (boş satırlar seyrek gelir)
    const rIndex = Number((r as Record<string, unknown>)["@r"]) - 1;
    const at = Number.isInteger(rIndex) && rIndex >= rows.length ? rIndex : rows.length;
    while (rows.length < at) rows.push([]);
    rows.push(filled);
    if (rows.length > STATEMENT_LIMITS.maxRows + 50) throw new StatementError(`Ekstre en fazla ${STATEMENT_LIMITS.maxRows} satır olabilir`);
  }
  return rows;
}

export function readTable(name: string, data: Uint8Array): { format: StatementFormat; table: Table } {
  const format = sniffStatement(name, data);
  return { format, table: format === "XLSX" ? parseXlsx(data) : parseCsv(decodeText(data)) };
}

// ---------------------------------------------------------------- sütun eşleme

export const FIELDS = ["date", "valueDate", "description", "amount", "debit", "credit", "balance", "reference"] as const;
export type Field = (typeof FIELDS)[number];
export type Mapping = Partial<Record<Field, number>> & { headerRow: number; invertSign?: boolean };

const norm = (s: string) =>
  s
    .toLocaleLowerCase("tr")
    .replace(/[ıİ]/g, "i")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Sıra önemli: "valör tarihi" tarih'ten, "işlem tutarı" açıklama'dan önce denenir
const SYNONYMS: Array<[Field, string[]]> = [
  ["valueDate", ["valor"]],
  ["date", ["islem tarihi", "tarih"]],
  ["balance", ["bakiye"]],
  ["debit", ["borc", "cikan", "giden"]],
  ["credit", ["alacak", "giren", "gelen"]],
  ["amount", ["tutar", "miktar"]],
  ["reference", ["dekont", "referans", "fis no", "islem no", "sira no"]],
  ["description", ["aciklama", "detay", "islem"]],
];

export function detectMapping(table: Table): Mapping | null {
  for (let r = 0; r < Math.min(table.length, 25); r++) {
    const mapping: Mapping = { headerRow: r };
    const used = new Set<number>();
    for (const [field, words] of SYNONYMS) {
      const idx = table[r].findIndex((cell, i) => !used.has(i) && words.some((w) => norm(cell).includes(w)));
      if (idx >= 0) {
        mapping[field] = idx;
        used.add(idx);
      }
    }
    const hasAmount = mapping.amount !== undefined || (mapping.debit !== undefined && mapping.credit !== undefined);
    if (mapping.date !== undefined && hasAmount) {
      // Tek "tutar" sütunu varken borç/alacak'tan yalnızca biri bulunduysa onu yok say
      if (mapping.amount !== undefined && (mapping.debit === undefined || mapping.credit === undefined)) {
        delete mapping.debit;
        delete mapping.credit;
      }
      return mapping;
    }
  }
  return null;
}

// ---------------------------------------------------------------- değer ayrıştırma

/** "1.234,56" / "1,234.56" / "-1234.5" / "(250,00)" / "1.234,56 TL" → Decimal; boşsa null. */
export function parseAmount(raw: string | undefined): Decimal | null {
  if (raw == null) return null;
  let s = raw.replace(/\s|TL|TRY|₺/gi, "");
  if (s === "" || s === "-") return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith("-")) {
    negative = true;
    s = s.slice(0, -1);
  }
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith("+")) s = s.slice(1);
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    // Yalnız virgül: sonda 1-2 hane → ondalık; değilse binlik ayırıcı
    s = /,\d{1,2}$/.test(s) && s.split(",").length === 2 ? s.replace(",", ".") : s.replace(/,/g, "");
  } else if (lastDot >= 0 && s.split(".").length > 2) {
    s = s.replace(/\./g, "");
  } else if (lastDot >= 0 && /^\d{1,3}\.\d{3}$/.test(s)) {
    // "1.234" Türkçe ekstrede binlik; ham Excel sayısı ise "1234" gelir — XLSX'te nokta ondalıktır
    s = s.replace(".", "");
  }
  if (!/^\d+(\.\d+)?$/.test(s)) throw new StatementError(`Tutar okunamadı: "${raw}"`);
  const value = new Decimal(s).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return negative ? value.neg() : value;
}

/** XLSX hücresi ham sayıysa "1.234" binlik sayılmamalı: XLSX değerleri önceden noktalı ondalığa çevrilir. */
function parseCellAmount(raw: string | undefined, format: StatementFormat): Decimal | null {
  if (format === "XLSX" && raw && /^-?\d+(\.\d+)?(E-?\d+)?$/i.test(raw)) return new Decimal(raw).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return parseAmount(raw);
}

/** "31.12.2026", "31/12/2026 14:05", "2026-12-31", Excel seri numarası → UTC gün */
export function parseDate(raw: string | undefined, format: StatementFormat): Date | null {
  if (!raw) return null;
  const s = raw.trim();
  if (format === "XLSX" && /^\d{5}(\.\d+)?$/.test(s)) {
    // Excel 1900 tarih sistemi: 25569 = 1970-01-01
    const days = Math.floor(Number(s)) - 25569;
    return new Date(days * 86_400_000);
  }
  let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (m) return utc(Number(m[3]), Number(m[2]), Number(m[1]));
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return utc(Number(m[1]), Number(m[2]), Number(m[3]));
  return null;
}

function utc(y: number, mo: number, d: number) {
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d ? date : null;
}

// ---------------------------------------------------------------- satırlar

export interface StatementRow {
  rowNo: number; // dosyadaki satır (1'den)
  txDate: Date;
  valueDate: Date | null;
  description: string;
  reference: string | null;
  amount: Decimal; // + giriş, − çıkış
  balance: Decimal | null;
}

export interface RowError {
  rowNo: number;
  message: string;
}

export function extractRows(table: Table, mapping: Mapping, format: StatementFormat): { rows: StatementRow[]; errors: RowError[]; skipped: number } {
  const rows: StatementRow[] = [];
  const errors: RowError[] = [];
  let skipped = 0;
  const cell = (r: string[], f: Field) => (mapping[f] === undefined ? undefined : r[mapping[f]!]);
  for (let i = mapping.headerRow + 1; i < table.length; i++) {
    const r = table[i];
    const rowNo = i + 1;
    if (!r.some((c) => c && c !== "")) continue; // boş satır
    const rawDate = cell(r, "date");
    const txDate = parseDate(rawDate, format);
    if (!txDate) {
      // Tarihi olmayan satırlar (ara toplam, devreden bakiye, dipnot) hareket değildir
      skipped++;
      continue;
    }
    try {
      let amount: Decimal | null;
      if (mapping.amount !== undefined) amount = parseCellAmount(cell(r, "amount"), format);
      else {
        const debit = parseCellAmount(cell(r, "debit"), format)?.abs() ?? new Decimal(0);
        const credit = parseCellAmount(cell(r, "credit"), format)?.abs() ?? new Decimal(0);
        amount = credit.minus(debit);
      }
      if (!amount || amount.isZero()) {
        skipped++;
        continue;
      }
      if (mapping.invertSign) amount = amount.neg();
      rows.push({
        rowNo,
        txDate,
        valueDate: parseDate(cell(r, "valueDate"), format),
        description: (cell(r, "description") ?? "").replace(/\s+/g, " ").trim().slice(0, 500) || "(açıklama yok)",
        reference: cell(r, "reference")?.slice(0, 100) || null,
        amount,
        balance: mapping.balance !== undefined ? parseCellAmount(cell(r, "balance"), format) : null,
      });
    } catch (e) {
      errors.push({ rowNo, message: e instanceof Error ? e.message : String(e) });
    }
    if (rows.length > STATEMENT_LIMITS.maxRows) throw new StatementError(`Ekstre en fazla ${STATEMENT_LIMITS.maxRows} hareket içerebilir`);
  }
  return { rows, errors, skipped };
}

// ---------------------------------------------------------------- bakiye kontrolü

export interface BalanceResult {
  status: "OK" | "MISMATCH" | "NO_BALANCE";
  /** Kronolojik sıradaki satırlar (banka yeniden eskiye listeliyorsa ters çevrilir) */
  ordered: StatementRow[];
  opening: Decimal | null;
  closing: Decimal | null;
  mismatches: Array<{ rowNo: number; expected: string; actual: string }>;
}

/** Her satırda önceki bakiye + tutar = bakiye olmalı. Sıra (eski→yeni / yeni→eski) bakiyeden anlaşılır. */
export function checkBalances(rows: StatementRow[]): BalanceResult {
  if (rows.length === 0) return { status: "NO_BALANCE", ordered: rows, opening: null, closing: null, mismatches: [] };
  const withBalance = rows.every((r) => r.balance !== null);
  const candidates = [rows, [...rows].reverse()];
  if (!withBalance) {
    const ordered = rows[0].txDate > rows[rows.length - 1].txDate ? candidates[1] : candidates[0];
    return { status: "NO_BALANCE", ordered, opening: null, closing: null, mismatches: [] };
  }
  const evaluate = (ordered: StatementRow[]) => {
    const mismatches: BalanceResult["mismatches"] = [];
    for (let i = 1; i < ordered.length; i++) {
      const expected = ordered[i - 1].balance!.plus(ordered[i].amount);
      if (!expected.eq(ordered[i].balance!)) mismatches.push({ rowNo: ordered[i].rowNo, expected: expected.toFixed(2), actual: ordered[i].balance!.toFixed(2) });
    }
    return mismatches;
  };
  const results = candidates.map((ordered) => ({ ordered, mismatches: evaluate(ordered) }));
  // Önce bakiyesi tutan sıra; ikisi de eşitse tarihe göre
  results.sort((a, b) => a.mismatches.length - b.mismatches.length || Number(a.ordered[0].txDate > a.ordered[a.ordered.length - 1].txDate) - Number(b.ordered[0].txDate > b.ordered[b.ordered.length - 1].txDate));
  const best = results[0];
  const first = best.ordered[0];
  const last = best.ordered[best.ordered.length - 1];
  return {
    status: best.mismatches.length === 0 ? "OK" : "MISMATCH",
    ordered: best.ordered,
    opening: first.balance!.minus(first.amount),
    closing: last.balance!,
    mismatches: best.mismatches,
  };
}

// ---------------------------------------------------------------- mükerrer

/**
 * Hareket parmak izi. Aynı dosyada aynı gün/tutar/açıklama/bakiye ile tekrar eden gerçek hareketler
 * dosya içi sıra numarasıyla ayrışır; aynı dosya tekrar yüklenince aynı izler üretilir.
 */
export function fingerprints(rows: StatementRow[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const base = [r.txDate.toISOString().slice(0, 10), r.amount.toFixed(2), r.description.toLocaleUpperCase("tr"), r.balance?.toFixed(2) ?? "", r.reference ?? ""].join("|");
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return createHash("sha256").update(`${base}#${n}`).digest("hex");
  });
}
