import { day, money } from "./format";
import type { SourceStatus } from "./instruments";
import type { Tab } from "./tabs";
import type { NetWorthLine } from "./wealth";

export interface AttentionItem {
  id: string;
  tone: "danger" | "warn" | "info";
  title: string;
  detail?: string;
  /** Where to go to deal with it. */
  to: Tab;
  /** A tab within that page. */
  section?: string;
}

/** A card bill is worth surfacing this many days before it's due. */
export const DUE_SOON_DAYS = 7;

const daysUntil = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

interface Inputs {
  today: string;
  /** Cards with a known statement. */
  bills: { key: string; label: string; bill: NonNullable<SourceStatus["bill"]> }[];
  /** Groups of wealth accounts that look like one account tracked twice. */
  duplicates: { name: string }[][];
  missingBalances: string[];
  /** Net worth lines whose latest figure is old. */
  staleLines: Pick<NetWorthLine, "key" | "label" | "asOf">[];
}

const TONE_ORDER = { danger: 0, warn: 1, info: 2 } as const;

/** Things that need the user to look: unpaid card bills, double-counted accounts, missing or old balances. */
export function attentionItems({ today, bills, duplicates, missingBalances, staleLines }: Inputs): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const { key, label, bill } of bills) {
    if (bill.state === "paid" || !bill.dueDate) continue;
    const left = money(Math.max(0, bill.totalDue - bill.paid));
    const days = daysUntil(today, bill.dueDate);
    if (bill.state === "overdue" || days < 0)
      items.push({ id: `bill-${key}`, tone: "danger", title: `${label} bill overdue`, detail: `${left} was due ${day(bill.dueDate)}`, to: "Spending", section: "cards" });
    else if (days <= DUE_SOON_DAYS)
      items.push({
        id: `bill-${key}`,
        tone: "warn",
        title: `${label} bill due ${days === 0 ? "today" : `in ${days} day${days === 1 ? "" : "s"}`}`,
        detail: `${left} by ${day(bill.dueDate)}`,
        to: "Spending",
        section: "cards",
      });
  }

  for (const group of duplicates) {
    const names = group.map((a) => a.name).join(" and ");
    items.push({ id: `dup-${names}`, tone: "warn", title: `${names} look like the same account`, detail: `Net worth counts it ${group.length} times`, to: "Net worth" });
  }

  if (missingBalances.length)
    items.push({
      id: "missing-balances",
      tone: "info",
      title: `No balance yet for ${missingBalances.join(", ")}`,
      detail: "They'll appear once an alert includes one",
      to: "Net worth",
    });

  for (const l of staleLines)
    items.push({ id: `stale-${l.key}`, tone: "info", title: `${l.label} is out of date`, detail: l.asOf ? `Last updated ${day(l.asOf)}` : "No balance recorded", to: "Net worth" });

  return items.sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]);
}
