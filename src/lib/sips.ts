import type { CASStatement, MFTransaction } from "@/types";
import { addMonths, groupSchemes } from "./capitalGains";
import { latestStatements } from "./portfolio";

export type Cadence = "Weekly" | "Monthly" | "Quarterly" | "Irregular";

export interface SipPlan {
  scheme: string;
  amc: string;
  /** Most recent instalment. */
  amount: number;
  cadence: Cadence;
  /** Typical day of month the instalment lands on. */
  day: number;
  count: number;
  invested: number;
  first: string;
  last: string;
  /** Expected date of the next instalment (active plans only). */
  next?: string;
  active: boolean;
  stepUps: { date: string; from: number; to: number }[];
  /** Months (YYYY-MM) inside the run with no instalment, for monthly plans. */
  missed: string[];
  bounced: { date: string; amount: number }[];
}

export interface SipSummary {
  plans: SipPlan[];
  active: SipPlan[];
  /** Active plans, normalised to a month. */
  monthlyOutflow: number;
  asOf?: string;
}

const DAY = 86_400_000;
const days = (a: string, b: string) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const amountOf = (t: MFTransaction) => Math.abs(t.amount ?? 0);

const cadenceOf = (gap: number): Cadence => (gap <= 10 ? "Weekly" : gap >= 20 && gap <= 45 ? "Monthly" : gap >= 75 && gap <= 105 ? "Quarterly" : "Irregular");
// Days after the last instalment beyond which a plan counts as stopped.
const GRACE: Record<Cadence, number> = { Weekly: 14, Monthly: 45, Quarterly: 135, Irregular: 60 };
const PER_MONTH: Record<Cadence, number> = { Weekly: 52 / 12, Monthly: 1, Quarterly: 1 / 3, Irregular: 0 };

const ym = (iso: string) => iso.slice(0, 7);
function monthsBetween(from: string, to: string) {
  const out: string[] = [];
  for (let m = ym(from); m <= ym(to); m = ym(addMonths(`${m}-01`, 1))) out.push(m);
  return out;
}

/** SIPs found in the statements: every scheme with at least two systematic instalments. */
export function sips(statements: CASStatement[]): SipSummary {
  const asOf = latestStatements(statements).map((s) => s.statementPeriod.to).sort().at(-1);
  const plans: SipPlan[] = [];

  for (const g of groupSchemes(statements)) {
    const buys = g.txns.filter((t) => t.type === "PURCHASE_SIP").sort((a, b) => a.date.localeCompare(b.date));
    // An instalment that bounced is listed and then reversed: it never happened, but tell the user.
    const bounced: SipPlan["bounced"] = [];
    const live = [...buys];
    for (const r of g.txns.filter((t) => t.type === "REVERSAL").sort((a, b) => a.date.localeCompare(b.date))) {
      let at = -1;
      for (let i = live.length - 1; i >= 0; i--) {
        if (live[i].date <= r.date && days(live[i].date, r.date) <= 10 && Math.abs(amountOf(live[i]) - amountOf(r)) < 1) {
          at = i;
          break;
        }
      }
      if (at >= 0) {
        bounced.push({ date: live[at].date, amount: amountOf(live[at]) });
        live.splice(at, 1);
      }
    }
    if (live.length + bounced.length < 2) continue;

    const dates = live.map((t) => t.date);
    const last = dates.at(-1) ?? bounced.at(-1)!.date;
    const first = dates[0] ?? bounced[0].date;
    const gaps = dates.slice(1).map((d, i) => days(dates[i], d));
    const cadence: Cadence = gaps.length ? cadenceOf(median(gaps)) : "Monthly";
    const active = Boolean(asOf) && days(last, asOf!) <= GRACE[cadence];

    const stepUps: SipPlan["stepUps"] = [];
    live.forEach((t, i) => {
      if (i > 0 && Math.abs(amountOf(t) - amountOf(live[i - 1])) >= 1) stepUps.push({ date: t.date, from: amountOf(live[i - 1]), to: amountOf(t) });
    });

    // A bounced month is reported under `bounced`, so only months with neither an instalment nor a bounce count as missed.
    const seen = new Set([...dates, ...bounced.map((b) => b.date)].map(ym));
    const missed = cadence === "Monthly" ? monthsBetween(first, last).filter((m) => !seen.has(m)) : [];

    plans.push({
      scheme: g.name,
      amc: g.amc,
      amount: live.length ? amountOf(live.at(-1)!) : bounced.at(-1)!.amount,
      cadence,
      day: live.length ? median(dates.map((d) => Number(d.slice(8)))) : Number(last.slice(8)),
      count: live.length,
      invested: live.reduce((s, t) => s + amountOf(t), 0),
      first,
      last,
      next: active && cadence === "Monthly" ? addMonths(last, 1) : undefined,
      active,
      stepUps,
      missed,
      bounced,
    });
  }

  plans.sort((a, b) => Number(b.active) - Number(a.active) || b.amount - a.amount);
  const active = plans.filter((p) => p.active);
  return { plans, active, monthlyOutflow: active.reduce((s, p) => s + p.amount * PER_MONTH[p.cadence], 0), asOf };
}
