import type { Goal } from "@/types";
import { schemeKey, type SchemeSummary } from "./portfolio";
import type { SipPlan } from "./sips";

export interface GoalProjection {
  current: number;
  monthly: number;
  /** True when `monthly` was taken from your SIPs rather than entered. */
  fromSips: boolean;
  months: number;
  projected: number;
  /** Monthly amount that reaches the target exactly. */
  required: number;
  onTrack: boolean;
  /** Share of the target already in the linked schemes. */
  progress: number;
  /** Linked schemes no longer in the portfolio. */
  missing: string[];
}

const PER_MONTH = { Weekly: 52 / 12, Monthly: 1, Quarterly: 1 / 3, Irregular: 0 } as const;

/** Whole months from `today` to `date`, never negative. */
export function monthsUntil(date: string, today: string) {
  const [y1, m1, d1] = today.split("-").map(Number);
  const [y2, m2, d2] = date.split("-").map(Number);
  return Math.max(0, (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0));
}

/** Future value of `current` plus `monthly` paid at each month's end, compounding monthly at an annual `rate`. */
export function futureValue(current: number, monthly: number, annual: number, months: number) {
  const r = Math.pow(1 + annual, 1 / 12) - 1;
  const g = Math.pow(1 + r, months);
  return current * g + monthly * (r === 0 ? months : (g - 1) / r);
}

export function requiredMonthly(current: number, target: number, annual: number, months: number) {
  if (months <= 0) return Math.max(0, target - current);
  const r = Math.pow(1 + annual, 1 / 12) - 1;
  const g = Math.pow(1 + r, months);
  const gap = target - current * g;
  return Math.max(0, r === 0 ? gap / months : (gap * r) / (g - 1));
}

export function projectGoal(goal: Goal, schemes: SchemeSummary[], plans: SipPlan[], today: string): GoalProjection {
  const linked = new Set(goal.schemes.map(schemeKey));
  const held = schemes.filter((s) => linked.has(schemeKey(s.name)));
  const current = held.reduce((s, x) => s + x.value, 0);
  const sipMonthly = plans.filter((p) => p.active && linked.has(schemeKey(p.scheme))).reduce((s, p) => s + p.amount * PER_MONTH[p.cadence], 0);
  const fromSips = goal.monthly == null;
  const monthly = goal.monthly ?? sipMonthly;
  const months = monthsUntil(goal.date, today);
  const rate = goal.returnPct / 100;
  const projected = futureValue(current, monthly, rate, months);
  const heldKeys = new Set(held.map((s) => schemeKey(s.name)));
  return {
    current,
    monthly,
    fromSips,
    months,
    projected,
    required: requiredMonthly(current, goal.target, rate, months),
    onTrack: projected >= goal.target,
    progress: goal.target > 0 ? current / goal.target : 0,
    missing: goal.schemes.filter((n) => !heldKeys.has(schemeKey(n))),
  };
}
