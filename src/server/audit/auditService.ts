import type { Prisma } from "@prisma/client";
import type { Tx } from "@/server/tenancy/tenantDb";

export interface AuditEntry {
  organizationId: string;
  actorUserId: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  taxpayerId?: string | null;
  details?: Prisma.InputJsonValue;
  ipAddress?: string | null;
}

/**
 * Denetim kaydı ekler. İşlemle aynı transaction içinde çağrılır: işlem geri alınırsa kayıt da düşer.
 * Parola, token ve tam kimlik numarası `details` içine yazılmamalıdır.
 */
export async function audit(tx: Tx, entry: AuditEntry) {
  await tx.auditLog.create({
    data: {
      organizationId: entry.organizationId,
      actorUserId: entry.actorUserId,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ?? null,
      taxpayerId: entry.taxpayerId ?? null,
      details: entry.details,
      ipAddress: entry.ipAddress?.slice(0, 64) ?? null,
    },
  });
}

/** Kimlik numarasını loglarda maskeler: 1234567890 → 12******90 */
export const maskTaxId = (value: string) => (value.length <= 4 ? "****" : `${value.slice(0, 2)}${"*".repeat(value.length - 4)}${value.slice(-2)}`);
