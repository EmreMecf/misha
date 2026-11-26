import { describe, expect, it } from "vitest";
import { excelSerial, simpleXlsx, turkishCsv } from "@/test/bankFixture";
import { checkBalances, decodeText, detectMapping, extractRows, fingerprints, parseAmount, parseDate, readTable, sniffStatement, StatementError } from "./statementParser";

const fmt = (rows: ReturnType<typeof extractRows>["rows"]) => rows.map((r) => [r.txDate.toISOString().slice(0, 10), r.amount.toFixed(2), r.balance?.toFixed(2) ?? null]);

describe("ekstre: değer ayrıştırma", () => {
  it("tutar biçimleri", () => {
    const cases: Array<[string, string]> = [
      ["1.234,56", "1234.56"],
      ["1,234.56", "1234.56"],
      ["-1.234,5", "-1234.50"],
      ["(250,00)", "-250.00"],
      ["250,00-", "-250.00"],
      ["1.234.567", "1234567.00"],
      ["1.234", "1234.00"],
      ["12.50", "12.50"],
      ["1 500,00 TL", "1500.00"],
      ["+75", "75.00"],
    ];
    for (const [raw, expected] of cases) expect(parseAmount(raw)?.toFixed(2), raw).toBe(expected);
    expect(parseAmount("")).toBeNull();
    expect(() => parseAmount("on iki")).toThrow(StatementError);
  });

  it("tarih biçimleri; geçersiz tarih null", () => {
    const iso = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;
    expect(iso(parseDate("05.11.2026", "CSV"))).toBe("2026-11-05");
    expect(iso(parseDate("5/11/2026 14:05", "CSV"))).toBe("2026-11-05");
    expect(iso(parseDate("2026-11-05", "CSV"))).toBe("2026-11-05");
    expect(iso(parseDate(String(excelSerial("2026-11-05")), "XLSX"))).toBe("2026-11-05");
    expect(parseDate("31.02.2026", "CSV")).toBeNull();
    expect(parseDate("Toplam", "CSV")).toBeNull();
  });

  it("Türkçe Windows-1254 kodlu dosya da okunur", () => {
    expect(decodeText(new Uint8Array([0x41, 0xe7, 0xfd, 0x6b, 0x6c, 0x61, 0x6d, 0x61]))).toBe("Açıklama");
  });

  it("PDF ve eski .xls açık mesajla reddedilir", () => {
    expect(() => sniffStatement("ekstre.pdf", new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toThrow(/geliştirme aşamasında/);
    expect(() => sniffStatement("ekstre.xls", new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]))).toThrow(/\.xlsx/);
  });
});

describe("ekstre: CSV", () => {
  const csv = turkishCsv([
    ["01.10.2026", "DEVİR / AÇILIŞ", "", "1.000,00", "1.000,00"],
    ["03.10.2026", "EFT ÖRNEK TEDARİK A.Ş. FATURA ORN2026000000011", "1.209,00", "", "-209,00"],
    ["05.10.2026", "HAVALE ÖRNEK ALICI LTD", "", "2.400,00", "2.191,00"],
    ["05.10.2026", "EFT ÜCRETİ", "6,50", "", "2.184,50"],
  ]);

  it("banka başlık satırları atlanır, sütunlar tahmin edilir, borç = çıkış / alacak = giriş", () => {
    const { format, table } = readTable("ekim.csv", csv);
    const mapping = detectMapping(table)!;
    expect(mapping).toMatchObject({ headerRow: 3, date: 0, description: 1, debit: 2, credit: 3, balance: 4 });
    const { rows, errors, skipped } = extractRows(table, mapping, format);
    expect(errors).toEqual([]);
    expect(skipped).toBe(1); // "Toplam" satırı
    expect(fmt(rows)).toEqual([
      ["2026-10-01", "1000.00", "1000.00"],
      ["2026-10-03", "-1209.00", "-209.00"],
      ["2026-10-05", "2400.00", "2191.00"],
      ["2026-10-05", "-6.50", "2184.50"],
    ]);
    const balance = checkBalances(rows);
    expect(balance).toMatchObject({ status: "OK", mismatches: [] });
    expect(balance.opening?.toFixed(2)).toBe("0.00");
    expect(balance.closing?.toFixed(2)).toBe("2184.50");
  });

  it("yeniden eskiye sıralı ekstre bakiyeden anlaşılıp kronolojik sıraya çevrilir", () => {
    const { format, table } = readTable("ters.csv", csv);
    const mapping = detectMapping(table)!;
    const rows = extractRows(table, mapping, format).rows.reverse();
    const balance = checkBalances(rows);
    expect(balance.status).toBe("OK");
    expect(balance.ordered[0].txDate.toISOString().slice(0, 10)).toBe("2026-10-01");
  });

  it("bakiye tutmayan satır bildirilir", () => {
    const bad = turkishCsv([
      ["01.10.2026", "A", "", "100,00", "100,00"],
      ["02.10.2026", "B", "30,00", "", "75,00"],
    ]);
    const { format, table } = readTable("hatali.csv", bad);
    const result = checkBalances(extractRows(table, detectMapping(table)!, format).rows);
    expect(result.status).toBe("MISMATCH");
    expect(result.mismatches).toEqual([{ rowNo: 6, expected: "70.00", actual: "75.00" }]);
  });

  it("tanınmayan başlıkta eşleme null döner (kullanıcı seçer); işaret ters çevrilebilir", () => {
    const { format, table } = readTable("x.csv", new TextEncoder().encode("Kol1;Kol2;Kol3\n01.10.2026;Ödeme;-50,00"));
    expect(detectMapping(table)).toBeNull();
    const rows = extractRows(table, { headerRow: 0, date: 0, description: 1, amount: 2, invertSign: true }, format).rows;
    expect(fmt(rows)).toEqual([["2026-10-01", "50.00", null]]);
  });

  it("parmak izi: aynı dosya aynı izleri verir; aynı gün aynı tutarlı iki gerçek hareket ayrışır", () => {
    const twin = turkishCsv([
      ["01.10.2026", "POS SATIŞ", "", "10,00", ""],
      ["01.10.2026", "POS SATIŞ", "", "10,00", ""],
    ]);
    const parse = () => {
      const { format, table } = readTable("pos.csv", twin);
      return fingerprints(extractRows(table, detectMapping(table)!, format).rows);
    };
    const a = parse();
    expect(new Set(a).size).toBe(2);
    expect(parse()).toEqual(a);
  });
});

describe("ekstre: XLSX", () => {
  it("paylaşılan metinler, sayısal tutarlar ve Excel tarih seri numaraları okunur", () => {
    const file = simpleXlsx(
      ["Tarih", "Valör", "Açıklama", "Tutar", "Bakiye", "Dekont No"],
      [
        [excelSerial("2026-10-01"), excelSerial("2026-10-01"), "Açılış", 500, 500, "D-1"],
        [excelSerial("2026-10-02"), excelSerial("2026-10-03"), "Kira ödemesi & aidat", -1234.5, -734.5, "D-2"],
      ],
    );
    const { format, table } = readTable("ekstre.xlsx", file);
    expect(format).toBe("XLSX");
    const mapping = detectMapping(table)!;
    expect(mapping).toMatchObject({ headerRow: 0, date: 0, valueDate: 1, description: 2, amount: 3, balance: 4, reference: 5 });
    const { rows } = extractRows(table, mapping, format);
    expect(fmt(rows)).toEqual([
      ["2026-10-01", "500.00", "500.00"],
      ["2026-10-02", "-1234.50", "-734.50"],
    ]);
    expect(rows[1]).toMatchObject({ description: "Kira ödemesi & aidat", reference: "D-2" });
    expect(rows[1].valueDate?.toISOString().slice(0, 10)).toBe("2026-10-03");
    expect(checkBalances(rows).status).toBe("OK");
  });
});
