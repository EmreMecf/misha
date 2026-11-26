import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export type Tx = Prisma.TransactionClient;

const TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

/**
 * Kiracı verisine erişimin tek yolu: transaction açar, PostgreSQL RLS bağlamını
 * (`app.organization_id`, isteğe bağlı `app.user_id`) yalnızca bu transaction için ayarlar.
 * Bağlam dışındaki sorgular kiracı tablolarında hiçbir satır göremez ve yazamaz.
 */
export async function withTenant<T>(
  scope: { organizationId: string; userId?: string | null },
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.organization_id', ${scope.organizationId}, true)`;
    if (scope.userId) await tx.$executeRaw`SELECT set_config('app.user_id', ${scope.userId}, true)`;
    return fn(tx);
  }, TX_OPTIONS);
}

/** Yalnızca kullanıcının kendi üyeliklerini görebildiği bağlam (giriş ve ofis seçimi). */
export async function withUserScope<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.user_id', ${userId}, true)`;
    return fn(tx);
  }, TX_OPTIONS);
}
