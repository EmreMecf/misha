import type { Role } from "@prisma/client";

/** Kaynak:işlem izinleri. Yeni modül izinlerini buraya ekleyin; matris tek kaynaktır. */
export const PERMISSIONS = [
  "taxpayer:read",
  "taxpayer:create",
  "taxpayer:update",
  "taxpayer:assign",
  "period:read",
  "period:manage",
  "member:read",
  "member:manage",
  "audit:read",
  "organization:manage",
  "document:read",
  "document:upload",
  "document:review",
  "ledger:read",
  "ledger:manage",
  "journal:edit",
  "journal:post",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL = new Set<Permission>(PERMISSIONS);

export const ROLE_PERMISSIONS: Readonly<Record<Role, ReadonlySet<Permission>>> = {
  OFFICE_OWNER: ALL,
  ACCOUNTANT: new Set([
    "taxpayer:read",
    "taxpayer:create",
    "taxpayer:update",
    "taxpayer:assign",
    "period:read",
    "period:manage",
    "member:read",
    "audit:read",
    "document:read",
    "document:upload",
    "document:review",
    "ledger:read",
    "ledger:manage",
    "journal:edit",
    "journal:post",
  ]),
  // Personel fiş önerisini düzenler; kesinleştirme ve hesap planı mali müşavirin işidir
  STAFF: new Set(["taxpayer:read", "period:read", "document:read", "document:upload", "document:review", "ledger:read", "journal:edit"]),
  AUDITOR: new Set(["taxpayer:read", "period:read", "member:read", "audit:read", "document:read", "ledger:read"]),
  // Mükellef kendi belgelerini yükleyip görebilir; kontrol/onay ofisin işidir
  TAXPAYER_USER: new Set(["taxpayer:read", "period:read", "document:read", "document:upload"]),
  READ_ONLY: new Set(["taxpayer:read", "period:read", "document:read", "ledger:read"]),
};

/** Bu roller ofisin tüm mükelleflerini görür; diğerleri yalnızca atandıklarını. */
export const SEES_ALL_TAXPAYERS: ReadonlySet<Role> = new Set(["OFFICE_OWNER", "ACCOUNTANT", "AUDITOR"]);

export const can = (role: Role, permission: Permission) => ROLE_PERMISSIONS[role].has(permission);

export const ROLE_LABELS: Readonly<Record<Role, string>> = {
  OFFICE_OWNER: "Ofis sahibi",
  ACCOUNTANT: "Mali müşavir",
  STAFF: "Muhasebe personeli",
  AUDITOR: "Denetçi",
  TAXPAYER_USER: "Mükellef",
  READ_ONLY: "Salt okunur",
};
