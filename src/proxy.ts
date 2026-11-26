import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "mihsap_session";
const PUBLIC_PAGES = ["/giris", "/kayit"];

/**
 * İyimser kontrol: oturum çerezi olmayan sayfa isteğini girişe yönlendirir (asıl doğrulama sunucu
 * bileşenlerinde ve API'de veritabanından yapılır). Tüm yanıtlara güvenlik başlıkları eklenir.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");
  const isPublic = PUBLIC_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  let response: NextResponse;
  if (!isApi && !isPublic && !request.cookies.has(SESSION_COOKIE)) {
    const url = request.nextUrl.clone();
    url.pathname = "/giris";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
    response = NextResponse.redirect(url);
  } else {
    response = NextResponse.next();
  }

  response.headers.set("X-Content-Type-Options", "nosniff");
  // Belge dosyası yalnızca kendi sayfamızdaki önizleme çerçevesinde açılabilir
  const isDocumentFile = /^\/api\/v1\/documents\/[^/]+\/file$/.test(pathname);
  response.headers.set("X-Frame-Options", isDocumentFile ? "SAMEORIGIN" : "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (isApi) response.headers.set("Cache-Control", "no-store");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
