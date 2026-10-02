import type { LeafData } from "./db";
import { day } from "./format";
import { cardRecords, instruments, sourceStatus } from "./instruments";
import { summarize } from "./portfolio";
import { epfOverview } from "./epf";
import { netWorth, WEALTH_KINDS, wealthLines, type NetWorthLine } from "./wealth";

/** Everything Leaf knows, as net worth lines: mutual funds, bank balances from alerts, card dues, and tracked accounts. */
export function computeNetWorth(data: LeafData, today: string) {
  const mf = summarize(data.statements);
  const sources = instruments(data.transactions, data.config, cardRecords(data.cardStatements, data.cardPayments));
  const status = (key: string) => sourceStatus(key, data.transactions, data.cardStatements, data.cardPayments, today);
  const wealth = wealthLines(data.wealthAccounts, data.wealthSnapshots, data.wealthFlows, today);
  // One line for EPF however many employers it spans; the EPF page has the split.
  const epf = epfOverview(data.wealthAccounts, data.wealthSnapshots, data.wealthFlows, today);
  const epfLine: NetWorthLine[] = epf.accounts.length
    ? [{ key: "epf", label: "EPF", group: "EPF", value: epf.total, asOf: epf.asOf, stale: epf.stale, note: epf.accounts.length > 1 ? `${epf.accounts.length} employers` : undefined }]
    : [];
  const otherAssets = wealth.assets.filter((l) => l.group !== WEALTH_KINDS.epf.label);

  const banks: NetWorthLine[] = sources
    .filter((s) => s.kind === "bank_account")
    .flatMap((s) => {
      const b = status(s.key).balance;
      const note = b?.adjusted ? `balance stated ${day(b.reportedOn)}, plus ${b.adjusted} transactions since` : "from alerts";
      return b ? [{ key: s.key, label: s.label, group: "Bank accounts", value: b.amount, asOf: b.asOf, stale: false, note }] : [];
    });
  const cards: NetWorthLine[] = sources
    .filter((s) => s.kind === "credit_card" || s.kind === "card")
    .flatMap((s) => {
      const st = status(s.key);
      const billDue = st.bill && st.bill.state !== "paid" ? Math.max(0, st.bill.totalDue - st.bill.paid) : 0;
      const due = billDue + Math.max(0, st.unbilled?.amount ?? 0);
      return due > 0 ? [{ key: s.key, label: s.label, group: "Credit cards", value: due, asOf: today, note: billDue ? "unpaid bill + unbilled" : "unbilled" }] : [];
    });
  const mfLine: NetWorthLine[] = mf.value ? [{ key: "mf", label: "Mutual funds", group: "Mutual funds", value: mf.value, asOf: mf.asOf, note: "from CAS" }] : [];
  const missingBalances = sources.filter((s) => s.kind === "bank_account" && !status(s.key).balance).map((s) => s.label);
  return { ...netWorth({ assets: [...mfLine, ...banks, ...epfLine, ...otherAssets], liabilities: [...cards, ...wealth.liabilities] }), missingBalances };
}
