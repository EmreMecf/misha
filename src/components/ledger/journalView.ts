import type { JournalEntryView } from "./JournalPanel";

interface EntryRow {
  id: string;
  status: JournalEntryView["status"];
  entryNo: number | null;
  entryDate: Date;
  description: string;
  version: number;
  reversalOfId: string | null;
  findings: unknown;
  lines: Array<{
    id: string;
    lineNo: number;
    kind: string;
    accountId: string | null;
    proposedAccountId: string | null;
    debit: { toFixed(n: number): string };
    credit: { toFixed(n: number): string };
    description: string;
    source: string;
    reason: string;
    account: { code: string; name: string } | null;
  }>;
}

/** Sunucudaki fiş kaydını istemci bileşenine geçecek düz (Decimal'siz) görünüme çevirir. */
export function toEntryView(e: EntryRow): JournalEntryView {
  return {
    id: e.id,
    status: e.status,
    entryNo: e.entryNo,
    entryDate: e.entryDate.toISOString().slice(0, 10),
    description: e.description,
    version: e.version,
    reversalOfId: e.reversalOfId,
    findings: Array.isArray(e.findings) ? (e.findings as JournalEntryView["findings"]) : [],
    lines: e.lines.map((l) => ({
      id: l.id,
      lineNo: l.lineNo,
      kind: l.kind,
      accountId: l.accountId,
      proposedAccountId: l.proposedAccountId,
      accountLabel: l.account ? `${l.account.code} ${l.account.name}` : null,
      debit: l.debit.toFixed(2),
      credit: l.credit.toFixed(2),
      description: l.description,
      source: l.source,
      reason: l.reason,
    })),
  };
}
