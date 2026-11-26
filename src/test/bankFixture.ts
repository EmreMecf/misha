// Sentetik banka ekstresi üreteçleri (testler için). Gerçek hesap/kişi verisi içermez.
import { zipSync } from "fflate";

const enc = (s: string) => new TextEncoder().encode(s);

/** Türkçe biçimli (noktalı virgül, virgüllü ondalık) CSV; başta banka başlık satırları */
export function turkishCsv(rows: Array<[date: string, description: string, debit: string, credit: string, balance: string]>, { bom = true } = {}) {
  const lines = [
    "ÖRNEK BANKASI A.Ş. HESAP EKSTRESİ",
    "Hesap: TR00 0000 0000 0000 0000 0000 00;;;;",
    "",
    "İşlem Tarihi;Açıklama;Borç;Alacak;Bakiye",
    ...rows.map((r) => r.join(";")),
    ";;;;",
    "Toplam;;;;",
  ];
  return enc(`${bom ? "﻿" : ""}${lines.join("\r\n")}`);
}

const cellRef = (c: number, r: number) => `${String.fromCharCode(65 + c)}${r}`;

/** En küçük geçerli XLSX: paylaşılan metinler + sayısal hücreler (tarih Excel seri numarası) */
export function simpleXlsx(header: string[], rows: Array<Array<string | number>>) {
  const strings: string[] = [];
  const sIdx = (s: string) => {
    const i = strings.indexOf(s);
    return i >= 0 ? i : strings.push(s) - 1;
  };
  const cell = (v: string | number, c: number, r: number) =>
    typeof v === "number" ? `<c r="${cellRef(c, r)}"><v>${v}</v></c>` : `<c r="${cellRef(c, r)}" t="s"><v>${sIdx(v)}</v></c>`;
  const sheetRows = [header, ...rows].map((row, r) => `<row r="${r + 1}">${row.map((v, c) => cell(v, c, r + 1)).join("")}</row>`).join("");
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return zipSync({
    "[Content_Types].xml": enc('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    "xl/workbook.xml": enc(
      '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Hareketler" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    "xl/_rels/workbook.xml.rels": enc(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    "xl/worksheets/sheet1.xml": enc(`<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`),
    "xl/sharedStrings.xml": enc(
      `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${strings.map((s) => `<si><t>${esc(s)}</t></si>`).join("")}</sst>`,
    ),
  });
}

/** 2026-10-15 gibi bir günün Excel seri numarası */
export const excelSerial = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000 + 25569;
