import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/server/auth/session";
import { can, type Permission } from "./permissions";
import { resolveContext, type RequestContext } from "./context";

/**
 * Sunucu bileşenlerinde oturum bağlamı (istek başına bir kez çözülür). Oturum yoksa girişe,
 * geçici parolayla girildiyse parola değişimine yönlendirir. `<Suspense>` içinden çağrılmalıdır.
 */
export const getPageContext = cache(async (options: { allowPasswordChange?: boolean } = {}): Promise<RequestContext> => {
  const ctx = await resolveContext((await cookies()).get(SESSION_COOKIE)?.value);
  if (!ctx) redirect("/giris");
  if (ctx.mustChangePassword && !options.allowPasswordChange) redirect("/hesabim?zorunlu=1");
  return ctx;
});

/** İzni yoksa sayfa yerine yetki mesajı gösterilmesi için. */
export const hasPermission = (ctx: RequestContext, permission: Permission) => can(ctx.role, permission);
