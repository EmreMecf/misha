// Sentetik UBL-TR fatura üreteci (testler için). Gerçek firma/kişi verisi içermez.

export interface FixtureLine {
  name: string;
  amount: string; // KDV hariç kalem tutarı
  vatRate: string;
  vatAmount: string;
  quantity?: string;
  unitCode?: string;
  unitPrice?: string;
  stockCode?: string;
}

export interface FixtureOptions {
  ettn?: string;
  invoiceNo?: string;
  issueDate?: string;
  profileId?: string;
  typeCode?: string;
  currency?: string;
  supplierTaxId: string;
  customerTaxId: string;
  supplierName?: string;
  customerName?: string;
  lines?: FixtureLine[];
  withholding?: { rate: string; amount: string } | null;
  /** Toplamları bilerek bozmak için (doğrulama testleri) */
  payableOverride?: string;
}

const sum = (xs: string[]) => xs.reduce((s, x) => s + Math.round(Number(x) * 100), 0) / 100;
const fmt = (n: number) => n.toFixed(2);

export function ublInvoiceXml(o: FixtureOptions): string {
  const lines = o.lines ?? [{ name: "Danışmanlık hizmeti", amount: "1000.00", vatRate: "20", vatAmount: "200.00" }];
  const cur = o.currency ?? "TRY";
  const lineTotal = sum(lines.map((l) => l.amount));
  const byRate = new Map<string, { taxable: number; tax: number }>();
  for (const l of lines) {
    const r = byRate.get(l.vatRate) ?? { taxable: 0, tax: 0 };
    byRate.set(l.vatRate, { taxable: r.taxable + Number(l.amount), tax: r.tax + Number(l.vatAmount) });
  }
  const vatTotal = sum(lines.map((l) => l.vatAmount));
  const inclusive = lineTotal + vatTotal;
  const payable = o.payableOverride ?? fmt(inclusive - Number(o.withholding?.amount ?? 0));
  const m = (v: string | number) => `currencyID="${cur}">${typeof v === "number" ? fmt(v) : v}`;
  const party = (id: string, name: string) => `<cac:Party>
      <cac:PartyIdentification><cbc:ID schemeID="${id.length === 11 ? "TCKN" : "VKN"}">${id}</cbc:ID></cac:PartyIdentification>
      <cac:PartyName><cbc:Name>${name}</cbc:Name></cac:PartyName>
      <cac:PostalAddress><cbc:StreetName>Örnek Cad.</cbc:StreetName><cbc:BuildingNumber>1</cbc:BuildingNumber><cbc:CitySubdivisionName>Merkez</cbc:CitySubdivisionName><cbc:CityName>Ankara</cbc:CityName><cac:Country><cbc:Name>Türkiye</cbc:Name></cac:Country></cac:PostalAddress>
      <cac:PartyTaxScheme><cac:TaxScheme><cbc:Name>Örnek</cbc:Name></cac:TaxScheme></cac:PartyTaxScheme>
    </cac:Party>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>TR1.2</cbc:CustomizationID>
  <cbc:ProfileID>${o.profileId ?? "TEMELFATURA"}</cbc:ProfileID>
  <cbc:ID>${o.invoiceNo ?? "TST2026000000001"}</cbc:ID>
  <cbc:UUID>${o.ettn ?? crypto.randomUUID()}</cbc:UUID>
  <cbc:IssueDate>${o.issueDate ?? "2026-10-15"}</cbc:IssueDate>
  <cbc:IssueTime>10:00:00</cbc:IssueTime>
  <cbc:InvoiceTypeCode>${o.typeCode ?? (o.withholding ? "TEVKIFAT" : "SATIS")}</cbc:InvoiceTypeCode>
  <cbc:Note>Test faturası</cbc:Note>
  <cbc:DocumentCurrencyCode>${cur}</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty>${party(o.supplierTaxId, o.supplierName ?? "ÖRNEK TEDARİK A.Ş.")}</cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>${party(o.customerTaxId, o.customerName ?? "ÖRNEK ALICI LTD. ŞTİ.")}</cac:AccountingCustomerParty>
  <cac:PaymentMeans><cbc:PaymentMeansCode>42</cbc:PaymentMeansCode><cac:PayeeFinancialAccount><cbc:ID>TR000000000000000000000000</cbc:ID></cac:PayeeFinancialAccount></cac:PaymentMeans>
  <cac:TaxTotal>
    <cbc:TaxAmount ${m(vatTotal)}</cbc:TaxAmount>
    ${[...byRate]
      .map(
        ([rate, v]) => `<cac:TaxSubtotal><cbc:TaxableAmount ${m(v.taxable)}</cbc:TaxableAmount><cbc:TaxAmount ${m(v.tax)}</cbc:TaxAmount><cbc:Percent>${rate}</cbc:Percent>
      <cac:TaxCategory><cac:TaxScheme><cbc:Name>KDV</cbc:Name><cbc:TaxTypeCode>0015</cbc:TaxTypeCode></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal>`,
      )
      .join("\n")}
  </cac:TaxTotal>
  ${
    o.withholding
      ? `<cac:WithholdingTaxTotal><cbc:TaxAmount ${m(o.withholding.amount)}</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount ${m(vatTotal)}</cbc:TaxableAmount><cbc:TaxAmount ${m(o.withholding.amount)}</cbc:TaxAmount><cbc:Percent>${o.withholding.rate}</cbc:Percent><cac:TaxCategory><cac:TaxScheme><cbc:Name>KDV TEVKİFAT</cbc:Name><cbc:TaxTypeCode>624</cbc:TaxTypeCode></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:WithholdingTaxTotal>`
      : ""
  }
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount ${m(lineTotal)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount ${m(lineTotal)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount ${m(inclusive)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount ${m(payable)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  ${lines
    .map(
      (l, i) => `<cac:InvoiceLine>
    <cbc:ID>${i + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="${l.unitCode ?? "C62"}">${l.quantity ?? "1"}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount ${m(l.amount)}</cbc:LineExtensionAmount>
    <cac:TaxTotal><cbc:TaxAmount ${m(l.vatAmount)}</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount ${m(l.amount)}</cbc:TaxableAmount><cbc:TaxAmount ${m(l.vatAmount)}</cbc:TaxAmount><cbc:Percent>${l.vatRate}</cbc:Percent><cac:TaxCategory><cac:TaxScheme><cbc:Name>KDV</cbc:Name><cbc:TaxTypeCode>0015</cbc:TaxTypeCode></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>
    <cac:Item><cbc:Name>${l.name}</cbc:Name>${l.stockCode ? `<cac:SellersItemIdentification><cbc:ID>${l.stockCode}</cbc:ID></cac:SellersItemIdentification>` : ""}</cac:Item>
    ${l.unitPrice ? `<cac:Price><cbc:PriceAmount ${m(l.unitPrice)}</cbc:PriceAmount></cac:Price>` : ""}
  </cac:InvoiceLine>`,
    )
    .join("\n")}
</Invoice>`;
}

export const encode = (s: string) => new TextEncoder().encode(s);
