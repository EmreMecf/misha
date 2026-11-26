// Gerçek PostgreSQL gerektirir: npm run db:up && npm run db:deploy && npm run test:integration
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { makeTckn, uniqueEmail, uniqueVkn } from "@/test/fixtures";
import { changePassword, login, registerOffice } from "@/server/auth/authService";
import { MAX_FAILURES_PER_EMAIL } from "@/server/auth/rateLimit";
import { resolveSession } from "@/server/auth/session";
import { listAuditLogs } from "@/server/audit/auditQueries";
import { resolveContext, type RequestContext } from "@/server/tenancy/context";
import { addMember, listMembers, updateMember } from "@/server/tenancy/memberService";
import { withTenant } from "@/server/tenancy/tenantDb";
import { createFiscalPeriod, listFiscalPeriods, setFiscalPeriodStatus } from "@/server/taxpayers/fiscalPeriodService";
import { assignMember, createTaxpayer, getTaxpayer, listTaxpayers, updateTaxpayer } from "@/server/taxpayers/taxpayerService";

const PASSWORD = "test-parolasi-123";
const createdUsers: string[] = [];
const createdOrgs: string[] = [];

async function office(label: string) {
  const email = uniqueEmail(label);
  const result = await registerOffice({ organizationName: `${label} Mali Müşavirlik`, fullName: `${label} Sahibi`, email, password: PASSWORD });
  createdUsers.push(result.userId);
  createdOrgs.push(result.organizationId);
  const ctx = (await resolveContext(result.token))!;
  return { ...result, email, ctx };
}

async function memberContext(owner: RequestContext, role: "STAFF" | "AUDITOR" | "READ_ONLY" | "ACCOUNTANT") {
  const email = uniqueEmail(role.toLowerCase());
  const { membership, temporaryPassword } = await addMember(owner, { email, fullName: `Test ${role}`, role });
  createdUsers.push(membership.userId);
  const session = await login({ email, password: temporaryPassword! });
  return { ctx: (await resolveContext(session.token))!, membership, email, temporaryPassword: temporaryPassword!, token: session.token };
}

let a: Awaited<ReturnType<typeof office>>;
let b: Awaited<ReturnType<typeof office>>;

beforeAll(async () => {
  a = await office("ofisA");
  b = await office("ofisB");
});

afterAll(async () => {
  // Test ofisleri sahip rolüyle (RLS bağlamında) silinir; kullanıcılar kiracı dışı tabloda
  for (const id of createdOrgs) await withTenant({ organizationId: id }, (tx) => tx.organization.deleteMany({ where: { id } }));
  await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
  await prisma.$disconnect();
});

describe("kimlik doğrulama (PostgreSQL)", () => {
  it("kayıt ofis + sahip üyeliği + oturum açar; token yalnızca özetiyle saklanır", async () => {
    expect(a.ctx).toMatchObject({ organizationId: a.organizationId, role: "OFFICE_OWNER" });
    const stored = await prisma.session.findMany({ where: { userId: a.userId } });
    expect(stored.every((s) => s.tokenHash !== a.token && /^[0-9a-f]{64}$/.test(s.tokenHash))).toBe(true);
  });

  it("aynı e-postayla ikinci kayıt reddedilir", async () => {
    await expect(registerOffice({ organizationName: "X Ofis", fullName: "Xavier Test", email: a.email, password: PASSWORD })).rejects.toThrow(/kayıtlı/);
  });

  it("yanlış parolada hangi alanın hatalı olduğu söylenmez; çok denemede hesap geçici kilitlenir", async () => {
    const { email } = await office("kilit");
    for (let i = 0; i < MAX_FAILURES_PER_EMAIL; i++) {
      await expect(login({ email, password: "yanlis-parola-1" }, { ipAddress: "10.0.0.9" })).rejects.toThrow("E-posta veya parola hatalı");
    }
    await expect(login({ email, password: PASSWORD }, { ipAddress: "10.0.0.9" })).rejects.toThrow(/Çok fazla/);
    await expect(login({ email: uniqueEmail("yok"), password: PASSWORD })).rejects.toThrow("E-posta veya parola hatalı");
  });

  it("parola değişince diğer oturumlar kapanır, geçerli oturum kalır", async () => {
    const other = await login({ email: a.email, password: PASSWORD });
    await changePassword({ userId: a.userId, sessionId: a.ctx.sessionId, organizationId: a.organizationId }, { currentPassword: PASSWORD, newPassword: "yeni-parola-456" });
    expect(await resolveSession(other.token)).toBeNull();
    expect(await resolveSession(a.token)).not.toBeNull();
    await changePassword({ userId: a.userId, sessionId: a.ctx.sessionId, organizationId: a.organizationId }, { currentPassword: "yeni-parola-456", newPassword: PASSWORD });
  });
});

describe("kiracı izolasyonu (PostgreSQL RLS)", () => {
  let taxpayerA: string;

  beforeAll(async () => {
    taxpayerA = (await createTaxpayer(a.ctx, { title: "A Ticaret Ltd. Şti.", taxId: uniqueVkn() })).id;
  });

  it("başka ofisin mükellefi listede görünmez ve doğrudan istenince bulunamadı döner", async () => {
    expect((await listTaxpayers(b.ctx)).map((t) => t.id)).not.toContain(taxpayerA);
    await expect(getTaxpayer(b.ctx, taxpayerA)).rejects.toThrow("Mükellef bulunamadı");
    await expect(updateTaxpayer(b.ctx, taxpayerA, { title: "ele geçirildi", version: 1 })).rejects.toThrow("bulunamadı");
    await expect(createFiscalPeriod(b.ctx, taxpayerA, { name: "2026", startDate: "2026-01-01", endDate: "2026-12-31" })).rejects.toThrow("bulunamadı");
  });

  it("veritabanı katmanı: B bağlamında filtresiz sorgu bile A'nın satırını göremez ve A adına yazamaz", async () => {
    const seen = await withTenant({ organizationId: b.organizationId }, (tx) => tx.taxpayer.findMany({ where: { id: taxpayerA } }));
    expect(seen).toEqual([]);
    await expect(
      withTenant({ organizationId: b.organizationId }, (tx) =>
        tx.taxpayer.create({ data: { organizationId: a.organizationId, title: "Sızma", taxIdType: "VKN", taxId: uniqueVkn() } }),
      ),
    ).rejects.toThrow();
  });

  it("bağlamsız bağlantı kiracı tablolarında hiçbir satır görmez", async () => {
    expect(await prisma.taxpayer.count()).toBe(0);
    expect(await prisma.organization.count()).toBe(0);
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it("denetim kaydı uygulama rolüyle silinemez ve değiştirilemez", async () => {
    await expect(withTenant({ organizationId: a.organizationId }, (tx) => tx.auditLog.deleteMany({}))).rejects.toThrow();
    await expect(withTenant({ organizationId: a.organizationId }, (tx) => tx.auditLog.updateMany({ data: { action: "x" } }))).rejects.toThrow();
  });
});

describe("rol ve mükellef ataması (PostgreSQL)", () => {
  it("personel yalnızca atandığı mükellefi görür; mükellef oluşturamaz", async () => {
    const t1 = await createTaxpayer(a.ctx, { title: "Atanmış A.Ş.", taxId: uniqueVkn() });
    const t2 = await createTaxpayer(a.ctx, { title: "Atanmamış Şahıs", taxId: makeTckn(String(100000000 + Math.floor(Math.random() * 8e8))) });
    const staff = await memberContext(a.ctx, "STAFF");
    await assignMember(a.ctx, t1.id, { membershipId: staff.membership.id });

    const visible = (await listTaxpayers(staff.ctx)).map((t) => t.id);
    expect(visible).toContain(t1.id);
    expect(visible).not.toContain(t2.id);
    await expect(getTaxpayer(staff.ctx, t2.id)).rejects.toThrow("bulunamadı");
    await expect(createTaxpayer(staff.ctx, { title: "Yetkisiz", taxId: uniqueVkn() })).rejects.toThrow("yetkiniz yok");
    await expect(listMembers(staff.ctx)).rejects.toThrow("yetkiniz yok");
  });

  it("yeni personel geçici parolayla girer ve parola değiştirmesi istenir; pasifleştirilince erişimi kesilir", async () => {
    const auditor = await memberContext(a.ctx, "AUDITOR");
    const again = await login({ email: auditor.email, password: auditor.temporaryPassword });
    expect(again.mustChangePassword).toBe(true);
    expect((await listAuditLogs(auditor.ctx)).items.length).toBeGreaterThan(0);

    await updateMember(a.ctx, auditor.membership.id, { status: "ARCHIVED" });
    expect(await resolveContext(auditor.token)).toBeNull();
    await expect(login({ email: auditor.email, password: auditor.temporaryPassword })).rejects.toThrow(/aktif bir ofis/);
  });

  it("ofisin son sahibi düşürülemez", async () => {
    await expect(updateMember(a.ctx, a.ctx.membershipId, { role: "ACCOUNTANT" })).rejects.toThrow("en az bir aktif sahibi");
  });
});

describe("mükellef ve mali dönem (PostgreSQL)", () => {
  it("aynı VKN ikinci kez eklenemez; geçersiz VKN reddedilir", async () => {
    const vkn = uniqueVkn();
    await createTaxpayer(a.ctx, { title: "Tekil A.Ş.", taxId: vkn });
    await expect(createTaxpayer(a.ctx, { title: "Kopya A.Ş.", taxId: vkn })).rejects.toThrow("zaten var");
    const invalid = vkn.slice(0, 9) + String((Number(vkn[9]) + 1) % 10);
    await expect(createTaxpayer(a.ctx, { title: "Hatalı", taxId: invalid })).rejects.toThrow("Geçerli bir VKN");
    // Farklı ofis aynı VKN'li mükellefi ayrıca tutabilir
    await expect(createTaxpayer(b.ctx, { title: "Tekil A.Ş.", taxId: vkn })).resolves.toBeTruthy();
  });

  it("eşzamanlı düzenleme: eski sürümle güncelleme çakışma verir", async () => {
    const t = await createTaxpayer(a.ctx, { title: "Sürüm A.Ş.", taxId: uniqueVkn() });
    const updated = await updateTaxpayer(a.ctx, t.id, { taxOffice: "Kadıköy", version: 1 });
    expect(updated.version).toBe(2);
    await expect(updateTaxpayer(a.ctx, t.id, { taxOffice: "Üsküdar", version: 1 })).rejects.toThrow("başkası tarafından değiştirildi");
  });

  it("mali dönemler çakışamaz; dönem kapatılıp açılabilir ve her adım denetim kaydına düşer", async () => {
    const t = await createTaxpayer(a.ctx, { title: "Dönem A.Ş.", taxId: uniqueVkn() });
    const p2026 = await createFiscalPeriod(a.ctx, t.id, { name: "2026", startDate: "2026-01-01", endDate: "2026-12-31" });
    await expect(createFiscalPeriod(a.ctx, t.id, { name: "2026-2", startDate: "2026-06-01", endDate: "2027-05-31" })).rejects.toThrow("çakışıyor");
    await expect(createFiscalPeriod(a.ctx, t.id, { name: "ters", startDate: "2027-12-31", endDate: "2027-01-01" })).rejects.toThrow();
    await createFiscalPeriod(a.ctx, t.id, { name: "2027", startDate: "2027-01-01", endDate: "2027-12-31" });
    expect((await listFiscalPeriods(a.ctx, t.id)).map((p) => p.name)).toEqual(["2027", "2026"]);

    expect((await setFiscalPeriodStatus(a.ctx, t.id, p2026.id, "CLOSED")).status).toBe("CLOSED");
    const actions = (await listAuditLogs(a.ctx, { taxpayerId: t.id })).items.map((l) => l.action);
    expect(actions).toEqual(["fiscal_period.close", "fiscal_period.create", "fiscal_period.create", "taxpayer.create"]);
  });
});
