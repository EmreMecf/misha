import { Prisma, type AccountRole } from "@prisma/client";
import { z } from "zod";
import { audit } from "@/server/audit/auditService";
import { AppError, notFound } from "@/server/errors";
import { assertPermission, tenantScope, type RequestContext } from "@/server/tenancy/context";
import { withTenant, type Tx } from "@/server/tenancy/tenantDb";
import { getAccessibleTaxpayer } from "@/server/taxpayers/taxpayerService";
import { DEFAULT_ROLE_ACCOUNTS, TDHP_ACCOUNTS } from "./tdhpTemplate";

export const ACCOUNT_ROLES = [
  "PURCHASE_DEFAULT",
  "INPUT_VAT",
  "SUPPLIER",
  "VAT_WITHHOLDING",
  "SALES_REVENUE",
  "OUTPUT_VAT",
  "CUSTOMER",
  "SALES_RETURN",
] as const satisfies readonly AccountRole[];

const auditBase = (ctx: RequestContext, taxpayerId: string) => ({
  organizationId: ctx.organizationId,
  actorUserId: ctx.userId,
  taxpayerId,
  ipAddress: ctx.ipAddress,
});

/** Mükellefin hesap planı ve rol eşlemeleri. */
export async function getChart(ctx: RequestContext, taxpayerId: string) {
  assertPermission(ctx, "ledger:read");
  return withTenant(tenantScope(ctx), async (tx) => {
    const taxpayer = await getAccessibleTaxpayer(tx, ctx, taxpayerId);
    const [accounts, mappings] = await Promise.all([
      tx.ledgerAccount.findMany({ where: { taxpayerId: taxpayer.id }, orderBy: { code: "asc" } }),
      tx.accountRoleMapping.findMany({ where: { taxpayerId: taxpayer.id } }),
    ]);
    return { taxpayer: { id: taxpayer.id, title: taxpayer.title }, accounts, mappings };
  });
}

/** Boş hesap planını TDHP şablonu ve varsayılan rol eşlemeleriyle başlatır (tekrar çağrılırsa hata). */
export async function initChartFromTemplate(ctx: RequestContext, taxpayerId: string) {
  assertPermission(ctx, "ledger:manage");
  return withTenant(tenantScope(ctx), async (tx) => {
    const taxpayer = await getAccessibleTaxpayer(tx, ctx, taxpayerId);
    if ((await tx.ledgerAccount.count({ where: { taxpayerId: taxpayer.id } })) > 0) {
      throw new AppError("CONFLICT", "Bu mükellefin hesap planı zaten var");
    }
    await tx.ledgerAccount.createMany({
      data: TDHP_ACCOUNTS.map(([code, name]) => ({ organizationId: ctx.organizationId, taxpayerId: taxpayer.id, code, name })),
    });
    const accounts = await tx.ledgerAccount.findMany({ where: { taxpayerId: taxpayer.id }, select: { id: true, code: true } });
    const byCode = new Map(accounts.map((a) => [a.code, a.id]));
    for (const [role, code] of Object.entries(DEFAULT_ROLE_ACCOUNTS)) {
      const accountId = byCode.get(code!);
      if (accountId) {
        await tx.accountRoleMapping.create({ data: { organizationId: ctx.organizationId, taxpayerId: taxpayer.id, role: role as AccountRole, accountId } });
      }
    }
    await audit(tx, { ...auditBase(ctx, taxpayer.id), action: "ledger.init", resourceType: "taxpayer", resourceId: taxpayer.id, details: { accounts: accounts.length } });
    return { accounts: accounts.length };
  });
}

// Kod: 3 haneli ana hesap + noktayla ayrılmış alt kırılımlar (ör. 320, 320.01, 770.01.005)
export const accountInputSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[0-9]{3}(\.[0-9A-Za-z]{1,10})*$/, "Hesap kodu 3 haneli ana hesap ve noktalı alt kırılımlardan oluşmalı (ör. 770.01)")
    .max(30),
  name: z.string().trim().min(2, "Hesap adı en az 2 karakter").max(200),
});

export async function createAccount(ctx: RequestContext, taxpayerId: string, input: z.input<typeof accountInputSchema>) {
  assertPermission(ctx, "ledger:manage");
  const data = accountInputSchema.parse(input);
  return withTenant(tenantScope(ctx), async (tx) => {
    const taxpayer = await getAccessibleTaxpayer(tx, ctx, taxpayerId);
    // Alt hesap açılırken üst hesap mevcut olmalı
    const parentCode = data.code.includes(".") ? data.code.slice(0, data.code.lastIndexOf(".")) : null;
    if (parentCode && !(await tx.ledgerAccount.findUnique({ where: { taxpayerId_code: { taxpayerId: taxpayer.id, code: parentCode } } }))) {
      throw new AppError("VALIDATION_ERROR", `Üst hesap ${parentCode} hesap planında yok`);
    }
    try {
      const account = await tx.ledgerAccount.create({ data: { organizationId: ctx.organizationId, taxpayerId: taxpayer.id, ...data } });
      await audit(tx, { ...auditBase(ctx, taxpayer.id), action: "ledger.account_create", resourceType: "ledger_account", resourceId: account.id, details: { code: data.code } });
      return account;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new AppError("CONFLICT", `${data.code} kodlu hesap zaten var`);
      throw error;
    }
  });
}

export const accountUpdateSchema = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  isActive: z.boolean().optional(),
  isPostable: z.boolean().optional(),
});

export async function updateAccount(ctx: RequestContext, taxpayerId: string, accountId: string, input: z.input<typeof accountUpdateSchema>) {
  assertPermission(ctx, "ledger:manage");
  const data = accountUpdateSchema.parse(input);
  return withTenant(tenantScope(ctx), async (tx) => {
    const taxpayer = await getAccessibleTaxpayer(tx, ctx, taxpayerId);
    const account = await findAccount(tx, taxpayer.id, accountId);
    if (data.isActive === false || data.isPostable === false) {
      const role = await tx.accountRoleMapping.findFirst({ where: { accountId: account.id } });
      if (role) throw new AppError("CONFLICT", "Bu hesap bir role atanmış; önce rol eşlemesini değiştirin");
    }
    const updated = await tx.ledgerAccount.update({ where: { id: account.id }, data });
    await audit(tx, { ...auditBase(ctx, taxpayer.id), action: "ledger.account_update", resourceType: "ledger_account", resourceId: account.id, details: { code: account.code, ...data } });
    return updated;
  });
}

export const roleMappingSchema = z.object({ role: z.enum(ACCOUNT_ROLES), accountId: z.uuid().nullable() });

export async function setRoleMapping(ctx: RequestContext, taxpayerId: string, input: z.input<typeof roleMappingSchema>) {
  assertPermission(ctx, "ledger:manage");
  const { role, accountId } = roleMappingSchema.parse(input);
  return withTenant(tenantScope(ctx), async (tx) => {
    const taxpayer = await getAccessibleTaxpayer(tx, ctx, taxpayerId);
    if (accountId === null) {
      await tx.accountRoleMapping.deleteMany({ where: { taxpayerId: taxpayer.id, role } });
    } else {
      const account = await findAccount(tx, taxpayer.id, accountId);
      if (!account.isActive || !account.isPostable) throw new AppError("VALIDATION_ERROR", "Pasif veya kayıt yapılamayan hesap role atanamaz");
      await tx.accountRoleMapping.upsert({
        where: { taxpayerId_role: { taxpayerId: taxpayer.id, role } },
        create: { organizationId: ctx.organizationId, taxpayerId: taxpayer.id, role, accountId: account.id },
        update: { accountId: account.id },
      });
    }
    await audit(tx, { ...auditBase(ctx, taxpayer.id), action: "ledger.role_mapping", resourceType: "taxpayer", resourceId: taxpayer.id, details: { role, accountId } });
    return { role, accountId };
  });
}

/** Kesin kurallar (satıcı/müşteri → hesap) */
export async function listPostingRules(ctx: RequestContext, taxpayerId: string) {
  assertPermission(ctx, "ledger:read");
  return withTenant(tenantScope(ctx), async (tx) => {
    const taxpayer = await getAccessibleTaxpayer(tx, ctx, taxpayerId);
    return tx.postingRule.findMany({
      where: { taxpayerId: taxpayer.id },
      include: { account: { select: { code: true, name: true } } },
      orderBy: [{ isActive: "desc" }, { counterpartyName: "asc" }],
    });
  });
}

export async function setPostingRuleActive(ctx: RequestContext, taxpayerId: string, ruleId: string, isActive: boolean) {
  assertPermission(ctx, "ledger:manage");
  return withTenant(tenantScope(ctx), async (tx) => {
    const taxpayer = await getAccessibleTaxpayer(tx, ctx, taxpayerId);
    const parsed = z.uuid().safeParse(ruleId);
    const rule = parsed.success ? await tx.postingRule.findFirst({ where: { id: parsed.data, taxpayerId: taxpayer.id } }) : null;
    if (!rule) throw notFound("Kural");
    const updated = await tx.postingRule.update({ where: { id: rule.id }, data: { isActive } });
    await audit(tx, { ...auditBase(ctx, taxpayer.id), action: isActive ? "ledger.rule_enable" : "ledger.rule_disable", resourceType: "posting_rule", resourceId: rule.id });
    return updated;
  });
}

export async function findAccount(tx: Tx, taxpayerId: string, accountId: string) {
  const parsed = z.uuid().safeParse(accountId);
  const account = parsed.success ? await tx.ledgerAccount.findFirst({ where: { id: parsed.data, taxpayerId } }) : null;
  if (!account) throw notFound("Hesap");
  return account;
}
