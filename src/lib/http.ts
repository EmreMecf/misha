import { unstable_rethrow } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, z } from "zod";
import { AppError } from "@/server/errors";
import { SESSION_COOKIE, SESSION_IDLE_MS } from "@/server/auth/session";
import { resolveContext, type RequestContext } from "@/server/tenancy/context";

/** Tek tip hata gövdesi: { error: { code, message, details? } } */
export function errorResponse(error: unknown): NextResponse {
  unstable_rethrow(error);
  if (error instanceof ZodError) {
    const flat = z.flattenError(error);
    const first = Object.values(flat.fieldErrors).flat()[0] ?? flat.formErrors[0] ?? "Geçersiz istek";
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: first, details: flat } }, { status: 422 });
  }
  if (error instanceof AppError) {
    return NextResponse.json({ error: { code: error.code, message: error.message, details: error.details } }, { status: error.status });
  }
  console.error(error);
  return NextResponse.json({ error: { code: "INTERNAL", message: "Beklenmeyen bir hata oluştu" } }, { status: 500 });
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new AppError("BAD_REQUEST", "İstek gövdesi geçerli JSON olmalı");
  }
}

export function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || null;
}

const appOrigin = () => process.env.APP_ORIGIN?.replace(/\/$/, "") ?? null;

/**
 * CSRF koruması: durum değiştiren isteklerde Origin başlığı uygulamanın kendi kökeni olmalı
 * (SameSite=Lax çerezle birlikte). Origin yoksa (eski istemci) Referer'a bakılır.
 */
export function assertSameOrigin(request: NextRequest | Request) {
  const expected = appOrigin() ?? new URL(request.url).origin;
  const origin = request.headers.get("origin") ?? (request.headers.get("referer") ? new URL(request.headers.get("referer")!).origin : null);
  if (origin !== expected) throw new AppError("FORBIDDEN", "İstek kaynağı doğrulanamadı");
}

/** API isteğinin bağlamı; oturum yoksa 401. Durum değiştiren isteklerde kaynak kontrolü de yapılır. */
export async function apiContext(request: NextRequest): Promise<RequestContext> {
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) assertSameOrigin(request);
  const ctx = await resolveContext(request.cookies.get(SESSION_COOKIE)?.value, clientIp(request));
  if (!ctx) throw new AppError("UNAUTHENTICATED", "Oturum açmanız gerekiyor");
  const allowedBeforeChange = ["/api/v1/auth/change-password", "/api/v1/auth/logout", "/api/v1/me"];
  if (ctx.mustChangePassword && !allowedBeforeChange.includes(request.nextUrl.pathname)) {
    throw new AppError("FORBIDDEN", "Devam etmeden önce geçici parolanızı değiştirin");
  }
  return ctx;
}

const secureCookies = () => (appOrigin() ?? "").startsWith("https://");

export function setSessionCookie(response: NextResponse, token: string) {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(SESSION_IDLE_MS / 1000),
  });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, secure: secureCookies(), sameSite: "lax", path: "/", maxAge: 0 });
}
