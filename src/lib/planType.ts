import type { SchemeSummary } from "./portfolio";

export type PlanType = "Direct" | "Regular" | "Unknown";

/** The CAS names an ARN for distributor-sold (Regular) schemes and "DIRECT" for Direct ones; names are the fallback. */
export function planTypeOf(s: Pick<SchemeSummary, "name" | "advisor">): PlanType {
  if (/direct/i.test(s.advisor ?? "")) return "Direct";
  if (/\bARN[-\s]?\d+/i.test(s.advisor ?? "")) return "Regular";
  if (/\bdirect\b/i.test(s.name)) return "Direct";
  if (/\bregular\b/i.test(s.name)) return "Regular";
  return "Unknown";
}

/** Commission a distributor typically earns on a Regular plan, per year, as a share of the money in it. */
export const TYPICAL_COMMISSION = { low: 0.005, high: 0.01 };

export function planMix(schemes: SchemeSummary[]) {
  const by = { Direct: 0, Regular: 0, Unknown: 0 } as Record<PlanType, number>;
  for (const s of schemes) by[planTypeOf(s)] += s.value;
  const regular = schemes.filter((s) => planTypeOf(s) === "Regular").sort((a, b) => b.value - a.value);
  return {
    by,
    regular,
    dragLow: by.Regular * TYPICAL_COMMISSION.low,
    dragHigh: by.Regular * TYPICAL_COMMISSION.high,
  };
}
