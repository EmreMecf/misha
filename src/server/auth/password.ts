import { hash, verify } from "@node-rs/argon2";
import { z } from "zod";

// argon2id (kütüphane varsayılanı), OWASP önerisine uygun bellek/iterasyon
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const passwordSchema = z
  .string()
  .min(10, "Parola en az 10 karakter olmalı")
  .max(200, "Parola en fazla 200 karakter olabilir");

export const hashPassword = (password: string) => hash(password, OPTIONS);

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// Kullanıcı yokken de aynı sürede yanıt vermek için (e-posta varlığını sızdırmamak)
let dummyHash: Promise<string> | null = null;
export async function burnPasswordCheck(password: string) {
  dummyHash ??= hashPassword("zamanlama-esitleme-parolasi");
  await verifyPassword(await dummyHash, password);
}
