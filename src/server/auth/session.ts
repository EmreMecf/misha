import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";

export const SESSION_COOKIE = "mihsap_session";
/** Kayan süre: kullanıldıkça uzar. */
export const SESSION_IDLE_MS = 7 * 24 * 60 * 60 * 1000;
/** Mutlak üst sınır: oturum ne kadar kullanılırsa kullanılsın bundan sonra biter. */
export const SESSION_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000;
/** last_seen_at en fazla bu aralıkla yazılır (her istekte yazma yükü olmasın). */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export interface SessionMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function createSession(userId: string, organizationId: string | null, meta: SessionMeta = {}, now = new Date()) {
  const token = randomBytes(32).toString("base64url");
  const session = await prisma.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      organizationId,
      ipAddress: meta.ipAddress?.slice(0, 64) ?? null,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + SESSION_IDLE_MS),
    },
  });
  return { token, session };
}

/** Geçerli oturum ve kullanıcısı; süresi dolmuş, iptal edilmiş veya kullanıcısı pasif ise null. */
export async function resolveSession(token: string | undefined | null, now = new Date()) {
  if (!token || token.length < 20 || token.length > 100) return null;
  const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!session || session.revokedAt || session.expiresAt <= now) return null;
  if (now.getTime() - session.createdAt.getTime() > SESSION_ABSOLUTE_MS) return null;
  if (session.user.status !== "ACTIVE") return null;

  if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    const absoluteEnd = session.createdAt.getTime() + SESSION_ABSOLUTE_MS;
    await prisma.session.update({
      where: { id: session.id },
      data: { lastSeenAt: now, expiresAt: new Date(Math.min(now.getTime() + SESSION_IDLE_MS, absoluteEnd)) },
    });
  }
  return session;
}

export async function revokeSession(token: string) {
  await prisma.session.updateMany({ where: { tokenHash: hashToken(token), revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function revokeAllSessions(userId: string, exceptSessionId?: string) {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date() },
  });
}

export async function setSessionOrganization(sessionId: string, organizationId: string) {
  await prisma.session.update({ where: { id: sessionId }, data: { organizationId } });
}
