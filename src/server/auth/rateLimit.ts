import { prisma } from "@/lib/db";

export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const MAX_FAILURES_PER_EMAIL = 5;
export const MAX_FAILURES_PER_IP = 20;

/** Pencere içindeki başarısız deneme sayısı sınırı aştıysa true. */
export async function isLoginBlocked(email: string, ipAddress: string | null, now = new Date()) {
  const since = new Date(now.getTime() - LOGIN_WINDOW_MS);
  const [byEmail, byIp] = await Promise.all([
    prisma.loginAttempt.count({ where: { email, success: false, createdAt: { gte: since } } }),
    ipAddress ? prisma.loginAttempt.count({ where: { ipAddress, success: false, createdAt: { gte: since } } }) : Promise.resolve(0),
  ]);
  return byEmail >= MAX_FAILURES_PER_EMAIL || byIp >= MAX_FAILURES_PER_IP;
}

export async function recordLoginAttempt(email: string, ipAddress: string | null, success: boolean, now = new Date()) {
  await prisma.loginAttempt.create({ data: { email, ipAddress: ipAddress?.slice(0, 64) ?? null, success, createdAt: now } });
}
