import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import type { DocumentFormat } from "@prisma/client";

/** Tek dosya ve tek yükleme sınırları. */
export const LIMITS = {
  maxFileBytes: 25 * 1024 * 1024,
  maxFilesPerUpload: 50,
  zip: {
    maxEntries: 500,
    maxTotalUncompressedBytes: 200 * 1024 * 1024,
    maxEntryBytes: 25 * 1024 * 1024,
    // Sıkıştırma oranı bundan büyükse zip bombası şüphesi
    maxRatio: 200,
  },
} as const;

export class FileRejected extends Error {}

export interface SniffResult {
  format: DocumentFormat;
  mimeType: string;
  extension: string;
}

const startsWith = (data: Uint8Array, bytes: number[], offset = 0) => bytes.every((b, i) => data[offset + i] === b);

/** XML mi? Baştaki BOM ve boşluklar atlanır; ilk anlamlı karakter "<" olmalı ve HTML olmamalı. */
function looksLikeXml(data: Uint8Array) {
  const head = new TextDecoder("utf-8", { fatal: false }).decode(data.slice(0, 512)).replace(/^﻿/, "").trimStart();
  if (!head.startsWith("<")) return false;
  return !/^<!doctype html|^<html/i.test(head);
}

const EXTENSIONS: Record<DocumentFormat, string[]> = {
  XML: ["xml"],
  PDF: ["pdf"],
  IMAGE: ["jpg", "jpeg", "png", "webp"],
  SPREADSHEET: ["xlsx", "xls"],
  CSV: ["csv"],
  ZIP: ["zip"],
  OTHER: [],
};

/**
 * Dosya biçimini içerik imzasından belirler; uzantı ile uyuşmazsa reddeder.
 * HTML, çalıştırılabilir dosya ve bilinmeyen biçimler kabul edilmez.
 */
export function sniffFile(name: string, data: Uint8Array): SniffResult {
  if (data.byteLength === 0) throw new FileRejected("Dosya boş");
  if (data.byteLength > LIMITS.maxFileBytes) throw new FileRejected(`Dosya ${LIMITS.maxFileBytes / 1024 / 1024} MB sınırını aşıyor`);
  const ext = name.toLowerCase().split(".").pop() ?? "";

  let result: SniffResult | null = null;
  if (startsWith(data, [0x25, 0x50, 0x44, 0x46, 0x2d])) result = { format: "PDF", mimeType: "application/pdf", extension: "pdf" };
  else if (startsWith(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) result = { format: "IMAGE", mimeType: "image/png", extension: "png" };
  else if (startsWith(data, [0xff, 0xd8, 0xff])) result = { format: "IMAGE", mimeType: "image/jpeg", extension: "jpg" };
  else if (startsWith(data, [0x52, 0x49, 0x46, 0x46]) && startsWith(data, [0x57, 0x45, 0x42, 0x50], 8)) result = { format: "IMAGE", mimeType: "image/webp", extension: "webp" };
  else if (startsWith(data, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) result = { format: "SPREADSHEET", mimeType: "application/vnd.ms-excel", extension: "xls" };
  else if (startsWith(data, [0x50, 0x4b, 0x03, 0x04]) || startsWith(data, [0x50, 0x4b, 0x05, 0x06])) {
    // XLSX de ZIP'tir; ayrım uzantı + içerikteki [Content_Types].xml ile
    const isXlsx = ext === "xlsx" && new TextDecoder("latin1").decode(data.slice(0, Math.min(data.byteLength, 4096))).includes("[Content_Types].xml");
    result = isXlsx
      ? { format: "SPREADSHEET", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", extension: "xlsx" }
      : { format: "ZIP", mimeType: "application/zip", extension: "zip" };
  } else if (looksLikeXml(data)) result = { format: "XML", mimeType: "application/xml", extension: "xml" };
  else if (ext === "csv") result = { format: "CSV", mimeType: "text/csv", extension: "csv" };

  if (!result) throw new FileRejected("Desteklenmeyen dosya türü (PDF, XML, JPG, PNG, WEBP, XLSX, XLS, CSV veya ZIP yükleyin)");
  if (!EXTENSIONS[result.format].includes(ext)) {
    throw new FileRejected(`Dosya uzantısı (.${ext || "yok"}) içeriğiyle uyuşmuyor; içerik ${result.format} görünüyor`);
  }
  return result;
}

export const sha256Hex = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

/** Zip içindeki güvenli dosya adı: dizin kısmı atılır, yol geçişi ve gizli dosyalar reddedilir. */
export function safeEntryName(entryName: string): string | null {
  const normalized = entryName.replace(/\\/g, "/");
  if (normalized.endsWith("/")) return null; // dizin
  if (normalized.startsWith("/") || /^[a-z]:/i.test(normalized) || normalized.split("/").includes("..")) {
    throw new FileRejected(`ZIP içinde güvensiz yol: ${entryName}`);
  }
  const base = normalized.split("/").pop()!;
  if (!base || base.startsWith(".") || normalized.startsWith("__MACOSX/")) return null;
  return base.slice(0, 255);
}

/**
 * ZIP'i güvenle açar: kayıt sayısı, toplam açılmış boyut, kayıt başı boyut ve sıkıştırma oranı sınırlı;
 * iç içe ZIP açılmaz (reddedilir). Sınırlar açmadan önce, başlık bilgisinden denetlenir.
 */
export function expandZip(data: Uint8Array): Array<{ name: string; data: Uint8Array }> {
  let entries = 0;
  let total = 0;
  const out: Array<{ name: string; data: Uint8Array }> = [];
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data, {
      filter: (file) => {
        const name = safeEntryName(file.name);
        if (!name) return false;
        entries += 1;
        total += file.originalSize;
        if (entries > LIMITS.zip.maxEntries) throw new FileRejected(`ZIP en fazla ${LIMITS.zip.maxEntries} dosya içerebilir`);
        if (file.originalSize > LIMITS.zip.maxEntryBytes) throw new FileRejected(`ZIP içindeki ${name} çok büyük`);
        if (total > LIMITS.zip.maxTotalUncompressedBytes) throw new FileRejected("ZIP açıldığında boyut sınırını aşıyor");
        if (file.size > 0 && file.originalSize / file.size > LIMITS.zip.maxRatio) throw new FileRejected("ZIP sıkıştırma oranı şüpheli (zip bombası)");
        return true;
      },
    });
  } catch (error) {
    if (error instanceof FileRejected) throw error;
    throw new FileRejected("ZIP dosyası açılamadı veya bozuk");
  }
  for (const [entryName, content] of Object.entries(files)) {
    const name = safeEntryName(entryName);
    if (!name) continue;
    if (name.toLowerCase().endsWith(".zip")) throw new FileRejected("İç içe ZIP desteklenmiyor");
    out.push({ name, data: content });
  }
  if (out.length === 0) throw new FileRejected("ZIP içinde işlenecek dosya yok");
  return out;
}
