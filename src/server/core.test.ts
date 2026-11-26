import { describe, expect, it } from "vitest";
import { makeTckn, makeVkn } from "@/test/fixtures";
import { maskTaxId } from "./audit/auditService";
import { hashToken } from "./auth/session";
import { can, PERMISSIONS, ROLE_PERMISSIONS, SEES_ALL_TAXPAYERS } from "./tenancy/permissions";
import { detectTaxId, isValidTckn, isValidVkn } from "./taxpayers/taxIds";

describe("VKN / TCKN doğrulama", () => {
  it("kontrol basamağı doğru VKN kabul edilir, tek hane değişince reddedilir", () => {
    for (const prefix of ["123456789", "000000001", "987654321", "450000001"]) {
      const vkn = makeVkn(prefix);
      expect(isValidVkn(vkn)).toBe(true);
      const wrong = vkn.slice(0, 9) + String((Number(vkn[9]) + 1) % 10);
      expect(isValidVkn(wrong)).toBe(false);
    }
    expect(isValidVkn("12345")).toBe(false);
    expect(isValidVkn("12345678ab")).toBe(false);
  });

  it("TCKN: ilk hane 0 olamaz, iki kontrol basamağı doğrulanır", () => {
    const tckn = makeTckn("123456789");
    expect(isValidTckn(tckn)).toBe(true);
    expect(isValidTckn("0" + tckn.slice(1))).toBe(false);
    expect(isValidTckn(tckn.slice(0, 10) + String((Number(tckn[10]) + 1) % 10))).toBe(false);
  });

  it("tür tespiti ve boşluk temizleme", () => {
    expect(detectTaxId(` ${makeVkn("123456789").replace(/(\d{3})/g, "$1 ")}`)).toEqual({ type: "VKN", value: makeVkn("123456789") });
    expect(detectTaxId(makeTckn("123456789"))?.type).toBe("TCKN");
    expect(detectTaxId("1111111111")).toBeNull();
  });
});

describe("izin matrisi", () => {
  it("ofis sahibi tüm izinlere sahip; salt okunur hiçbir şey değiştiremez", () => {
    for (const p of PERMISSIONS) expect(can("OFFICE_OWNER", p)).toBe(true);
    for (const p of PERMISSIONS.filter((x) => !x.endsWith(":read"))) expect(can("READ_ONLY", p)).toBe(false);
  });

  it("personel mükellef oluşturamaz ve üye yönetemez; denetçi denetim kaydını okur ama değiştiremez", () => {
    expect(can("STAFF", "taxpayer:create")).toBe(false);
    expect(can("STAFF", "member:manage")).toBe(false);
    expect(can("AUDITOR", "audit:read")).toBe(true);
    expect(can("AUDITOR", "taxpayer:update")).toBe(false);
  });

  it("yalnızca sahip, mali müşavir ve denetçi tüm mükellefleri görür", () => {
    expect([...SEES_ALL_TAXPAYERS].sort()).toEqual(["ACCOUNTANT", "AUDITOR", "OFFICE_OWNER"]);
  });

  it("her rolün izinleri bilinen izinlerden oluşur", () => {
    for (const set of Object.values(ROLE_PERMISSIONS)) for (const p of set) expect(PERMISSIONS).toContain(p);
  });
});

describe("güvenlik yardımcıları", () => {
  it("oturum token'ı geri döndürülemez özetle saklanır", () => {
    const h = hashToken("token-ornegi");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain("token");
  });

  it("kimlik numarası loglarda maskelenir", () => {
    expect(maskTaxId("1234567890")).toBe("12******90");
    expect(maskTaxId("123")).toBe("****");
  });
});
