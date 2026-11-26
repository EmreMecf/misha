import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { makeVkn } from "@/test/fixtures";
import { encode, ublInvoiceXml } from "@/test/ublFixture";
import { expandZip, FileRejected, safeEntryName, sniffFile } from "./fileSecurity";
import { canTransition, TRANSITIONS } from "./stateMachine";
import { resolveDirection, validateInvoice } from "./ubl/invoiceValidation";
import { looksLikeUblInvoice, parseUblInvoice, UblParseError } from "./ubl/ublParser";

const SUPPLIER = makeVkn("111111112");
const CUSTOMER = makeVkn("222222223");

describe("dosya güvenliği", () => {
  it("biçim içerik imzasından belirlenir", () => {
    expect(sniffFile("a.pdf", encode("%PDF-1.7\n...")).format).toBe("PDF");
    expect(sniffFile("a.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])).mimeType).toBe("image/png");
    expect(sniffFile("a.jpg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0])).format).toBe("IMAGE");
    expect(sniffFile("f.xml", encode(`\uFEFF  <?xml version="1.0"?><Invoice/>`)).format).toBe("XML");
    expect(sniffFile("b.zip", zipSync({ "x.xml": encode("<a/>") })).format).toBe("ZIP");
  });

  it("uzantı ile içerik uyuşmazsa, HTML veya bilinmeyen içerik reddedilir", () => {
    expect(() => sniffFile("fatura.pdf", encode("<?xml version='1.0'?><a/>"))).toThrow(/uyuşmuyor/);
    expect(() => sniffFile("sayfa.xml", encode("<!DOCTYPE html><html><script>alert(1)</script></html>"))).toThrow(FileRejected);
    expect(() => sniffFile("program.exe", new Uint8Array([0x4d, 0x5a, 0x90, 0]))).toThrow(/Desteklenmeyen/);
    expect(() => sniffFile("bos.xml", new Uint8Array())).toThrow(/boş/);
  });

  it("ZIP: yol geçişi ve iç içe ZIP reddedilir, gizli/dizin kayıtları atlanır", () => {
    expect(() => safeEntryName("../../etc/passwd")).toThrow(/güvensiz/);
    expect(() => safeEntryName("C:/Windows/x.xml")).toThrow(/güvensiz/);
    expect(safeEntryName("klasor/fatura.xml")).toBe("fatura.xml");
    expect(safeEntryName("__MACOSX/._fatura.xml")).toBeNull();
    expect(() => expandZip(zipSync({ "ic.zip": zipSync({ "a.xml": encode("<a/>") }) }))).toThrow(/İç içe/);
    expect(expandZip(zipSync({ "a/b.xml": encode("<a/>"), "c.pdf": encode("%PDF-1.4") })).map((e) => e.name).sort()).toEqual(["b.xml", "c.pdf"]);
  });

  it("ZIP bombası: aşırı sıkıştırma oranı reddedilir", () => {
    const bomb = zipSync({ "bomba.xml": new Uint8Array(5 * 1024 * 1024) }, { level: 9 });
    expect(() => expandZip(bomb)).toThrow(/zip bombası/);
  });
});

describe("UBL-TR ayrıştırıcı", () => {
  const xml = ublInvoiceXml({
    supplierTaxId: SUPPLIER,
    customerTaxId: CUSTOMER,
    invoiceNo: "ABC2026000000077",
    lines: [
      { name: "Un 50 kg", amount: "900.00", vatRate: "1", vatAmount: "9.00", quantity: "10", unitCode: "C62", unitPrice: "90", stockCode: "UN50" },
      { name: "Deterjan", amount: "250.00", vatRate: "20", vatAmount: "50.00" },
    ],
  });

  it("başlık, taraflar, kalemler, vergiler ve toplamlar Decimal olarak okunur; alan kaynağı kaydedilir", () => {
    const { invoice, fields } = parseUblInvoice(xml);
    expect(looksLikeUblInvoice(xml)).toBe(true);
    expect(invoice.invoiceNo).toBe("ABC2026000000077");
    expect(invoice.supplier).toMatchObject({ taxId: SUPPLIER, scheme: "VKN", city: "Ankara" });
    expect(invoice.lines.map((l) => [l.stockCode, l.quantity.toString(), l.vatRate.toString(), l.lineAmount.toFixed(2)])).toEqual([
      ["UN50", "10", "1", "900.00"],
      [null, "1", "20", "250.00"],
    ]);
    expect(invoice.taxes.map((t) => [t.rate?.toString(), t.amount.toFixed(2)])).toEqual([["1", "9.00"], ["20", "50.00"]]);
    expect(invoice.totals.payable.toFixed(2)).toBe("1209.00");
    expect(fields.ettn).toMatchObject({ method: "XML_PARSER", confidence: 1, source: "/Invoice/cbc:UUID" });
    expect(fields.iban.value).toBe("TR000000000000000000000000");
  });

  it("DTD / varlık tanımı içeren XML güvenlik nedeniyle reddedilir", () => {
    const evil = xml.replace('<?xml version="1.0" encoding="UTF-8"?>', '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]>');
    expect(() => parseUblInvoice(evil)).toThrow(/DTD/);
  });

  it("zorunlu alan eksikse veya fatura değilse açık hata verir", () => {
    expect(() => parseUblInvoice(xml.replace(/<cbc:UUID>[^<]+<\/cbc:UUID>/, ""))).toThrow(UblParseError);
    expect(() => parseUblInvoice("<?xml version='1.0'?><DespatchAdvice/>")).toThrow(/UBL fatura değil/);
  });

  it("tevkifat ödenecek tutardan düşülür", () => {
    const { invoice } = parseUblInvoice(ublInvoiceXml({ supplierTaxId: SUPPLIER, customerTaxId: CUSTOMER, withholding: { rate: "50", amount: "100.00" } }));
    expect(invoice.totals.withholdingTotal.toFixed(2)).toBe("100.00");
    expect(invoice.totals.payable.toFixed(2)).toBe("1100.00");
    expect(validateInvoice(invoice).errors).toEqual([]);
  });
});

describe("fatura doğrulama", () => {
  it("tutarlı fatura hatasız; kontrol basamağı tutmayan VKN uyarı verir", () => {
    const ok = parseUblInvoice(ublInvoiceXml({ supplierTaxId: SUPPLIER, customerTaxId: CUSTOMER })).invoice;
    expect(validateInvoice(ok)).toEqual({ errors: [], warnings: [] });
    const badVkn = parseUblInvoice(ublInvoiceXml({ supplierTaxId: "1111111111", customerTaxId: CUSTOMER })).invoice;
    expect(validateInvoice(badVkn).warnings.map((w) => w.code)).toContain("PARTY_TAX_ID_CHECKSUM");
  });

  it("ödenecek tutar tutmazsa uyarı; döviz faturasında kur yoksa hata", () => {
    const off = parseUblInvoice(ublInvoiceXml({ supplierTaxId: SUPPLIER, customerTaxId: CUSTOMER, payableOverride: "1500.00" })).invoice;
    expect(validateInvoice(off).warnings.map((w) => w.code)).toContain("PAYABLE_MISMATCH");
    const usd = parseUblInvoice(ublInvoiceXml({ supplierTaxId: SUPPLIER, customerTaxId: CUSTOMER, currency: "USD" })).invoice;
    expect(validateInvoice(usd).errors.map((e) => e.code)).toEqual(["EXCHANGE_RATE_MISSING"]);
  });

  it("yön: alıcı mükellefse alış, satıcıysa satış, ikisi de değilse null", () => {
    const inv = parseUblInvoice(ublInvoiceXml({ supplierTaxId: SUPPLIER, customerTaxId: CUSTOMER })).invoice;
    expect(resolveDirection(inv, CUSTOMER)).toBe("PURCHASE");
    expect(resolveDirection(inv, SUPPLIER)).toBe("SALE");
    expect(resolveDirection(inv, makeVkn("333333334"))).toBeNull();
  });
});

describe("belge durum makinesi", () => {
  it("geçerli ve geçersiz geçişler", () => {
    expect(canTransition("QUEUED", "CLASSIFYING")).toBe(true);
    expect(canTransition("NEEDS_REVIEW", "ACCOUNTING_PENDING")).toBe(true);
    expect(canTransition("UPLOADED", "APPROVED")).toBe(false);
    expect(canTransition("NEEDS_REVIEW", "EXPORTED")).toBe(false);
    expect(TRANSITIONS.ARCHIVED).toEqual([]);
  });

  it("her durumdan tanımlı geçişler yine tanımlı durumlara gider", () => {
    const all = Object.keys(TRANSITIONS);
    for (const targets of Object.values(TRANSITIONS)) for (const t of targets) expect(all).toContain(t);
  });
});
