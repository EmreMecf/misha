import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Yerel dosya deposu (S3 uyumlu depoya geçiş bu arayüzün arkasında yapılır).
 * Anahtarlar ofis kimliğiyle başlar; anahtar dışarıdan gelmez, her zaman burada üretilir.
 */
const root = () => path.resolve(/*turbopackIgnore: true*/ process.env.STORAGE_DIR ?? path.join(process.cwd(), "storage"));

function resolveKey(key: string) {
  if (!/^[0-9a-f-]{36}\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.[a-z0-9]{1,5}$/.test(key)) throw new Error("Geçersiz depolama anahtarı");
  const full = path.resolve(root(), key);
  if (!full.startsWith(root() + path.sep)) throw new Error("Depolama kökü dışına erişim engellendi");
  return full;
}

export async function storeFile(organizationId: string, data: Uint8Array, extension: string, now = new Date()): Promise<string> {
  const ext = extension.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "bin";
  const key = `${organizationId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.${ext}`;
  const full = resolveKey(key);
  await mkdir(/*turbopackIgnore: true*/ path.dirname(full), { recursive: true });
  await writeFile(/*turbopackIgnore: true*/ full, data, { flag: "wx" });
  return key;
}

export async function readStoredFile(key: string): Promise<Buffer> {
  return readFile(/*turbopackIgnore: true*/ resolveKey(key));
}
