// What your policies say and whether it's enough: plain-language findings from the terms read off the policy
// document, plus checks against your income. The thresholds are rules of thumb, not advice.

import type { InsurancePolicy, Payslip } from "@/types";

export type Level = "good" | "watch" | "info";

export interface Finding {
  level: Level;
  title: string;
  detail: string;
}

const lakh = (n: number) => `₹${(n / 1e5).toFixed(n % 1e5 ? 1 : 0)} lakh`;
const daysUntil = (iso: string, today: string) => Math.round((Date.parse(iso) - Date.parse(today)) / 86_400_000);

/** Findings for one policy, from what its document states. A term the document didn't state produces nothing. */
export function assessPolicy(p: InsurancePolicy, today: string): Finding[] {
  const out: Finding[] = [];
  const add = (level: Level, title: string, detail: string) => out.push({ level, title, detail });
  const t = p.terms;

  if (p.renewalDate) {
    const d = daysUntil(p.renewalDate, today);
    if (d < 0) add("watch", "Renewal date has passed", `It was due ${p.renewalDate}. Check the policy hasn't lapsed; a break can restart waiting periods.`);
    else if (d <= 45) add("watch", `Renews in ${d} day${d === 1 ? "" : "s"}`, "Renew before the grace period ends so waiting periods and bonus carry on.");
  }
  if (!t) return out;

  if (t.roomRent) {
    if (t.roomRent.kind === "no_limit") add("good", "No room-rent limit", "Your room choice doesn't reduce what the claim pays.");
    else if (t.roomRent.kind === "capped")
      add("watch", "Room rent is capped", `${t.roomRent.detail ?? "A daily limit applies"}. Pick a pricier room and many policies cut the whole bill (doctor fees, procedures) in the same proportion, not just the room.`);
    else if (t.roomRent.kind === "single_private") add("info", "Room category limit", `${t.roomRent.detail ?? "Single private room"}: a costlier category may reduce the claim.`);
    else add("info", "Shared room", "Covers a shared room; a private room may be partly your cost.");
  }
  if (t.coPayPct !== undefined) {
    if (t.coPayPct > 0) add("watch", `${t.coPayPct}% co-payment`, `You pay ${t.coPayPct}% of every claim yourself, so a ₹5 lakh bill costs you ₹${Math.round(5e5 * t.coPayPct / 100).toLocaleString("en-IN")}.`);
    else add("good", "No co-payment", "The policy pays the full admissible claim.");
  }
  if (t.deductible) add("info", `Deductible ${lakh(t.deductible)}`, "Pays only above this amount: meant to sit on top of a base policy, not replace one.");
  if (t.waitingPreExistingMonths !== undefined) {
    const m = t.waitingPreExistingMonths;
    if (m <= 24) add("good", `Pre-existing diseases covered after ${m} months`, "A short wait for conditions you already have.");
    else add("watch", `Pre-existing diseases wait ${m} months`, "Conditions you had before buying aren't covered until then.");
  }
  if (t.waitingSpecificMonths !== undefined && t.waitingSpecificMonths >= 24) add("watch", `${t.waitingSpecificMonths}-month wait for listed illnesses`, "Cataract, hernia, joint replacement and similar are covered only after this.");
  if (t.restore === true) add("good", "Cover restores after a claim", "The sum insured refills if a claim uses it up, usually for a different illness.");
  else if (t.restore === false) add("info", "No restore benefit", "Once a claim uses the cover, that year's cover stays reduced.");
  if (t.noClaimBonusPct) add("good", `${t.noClaimBonusPct}% no-claim bonus`, "Cover grows for each claim-free year.");
  if (t.subLimits?.length) add("watch", "Sub-limits on treatments", t.subLimits.slice(0, 5).join("; "));
  if (t.floater === true) add("info", "Family floater", "One sum insured is shared by everyone covered; one serious claim can use most of it.");
  if (t.cashless === false) add("watch", "No cashless treatment", "You pay at the hospital and claim back.");
  if (t.exclusions?.length) add("info", "Notable exclusions", t.exclusions.join("; "));

  const rank: Record<Level, number> = { watch: 0, good: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

export interface CoverageCheck {
  level: Level;
  title: string;
  detail: string;
}

export interface Coverage {
  health: number;
  termLife: number;
  /** Premiums across policies, counted as yearly. */
  yearlyPremium: number;
  healthPremium: number;
  /** Gross pay over the last 12 payslips' months, or the latest month ×12. */
  annualIncome?: number;
  checks: CoverageCheck[];
  nextRenewal?: { policy: InsurancePolicy; days: number };
}

/** Annual gross from payslips: the last year's worth if there is that much, else the latest month ×12. */
export function annualIncome(payslips: Payslip[]): number | undefined {
  const sorted = [...payslips].sort((a, b) => b.month.localeCompare(a.month));
  if (!sorted.length) return undefined;
  const year = sorted.slice(0, 12);
  return year.length >= 12 ? year.reduce((s, p) => s + p.gross, 0) : sorted[0].gross * 12;
}

export function coverage(policies: InsurancePolicy[], payslips: Payslip[], today: string): Coverage {
  const sum = (f: (p: InsurancePolicy) => boolean, v: (p: InsurancePolicy) => number | undefined) => policies.filter(f).reduce((s, p) => s + (v(p) ?? 0), 0);
  const health = sum((p) => p.type === "health", (p) => p.cover);
  const termLife = sum((p) => p.type === "term_life", (p) => p.cover);
  const income = annualIncome(payslips);
  const checks: CoverageCheck[] = [];

  if (policies.length) {
    if (!health) checks.push({ level: "watch", title: "No health cover on record", detail: "A single hospital stay can cost lakhs. Import your health policy, or consider one." });
    else if (health < 10e5) checks.push({ level: "watch", title: `Health cover is ${lakh(health)}`, detail: "Rule of thumb: at least ₹10 lakh each in a metro city, more with a family or dependants. A cheap super top-up can raise it." });
    else checks.push({ level: "good", title: `Health cover is ${lakh(health)}`, detail: "In line with the usual ₹10 lakh-plus guidance for a metro city." });

    if (income) {
      if (!termLife) checks.push({ level: "watch", title: "No term life cover on record", detail: `If anyone depends on your income (about ${lakh(income)} a year), a term plan of 10–15× income is the usual guidance.` });
      else if (termLife < income * 10) checks.push({ level: "watch", title: `Term cover is ${(termLife / income).toFixed(1)}× your income`, detail: `The usual guidance is 10–15× annual income (about ${lakh(income * 10)}–${lakh(income * 15)} for you). Loans outstanding add to what's needed.` });
      else checks.push({ level: "good", title: `Term cover is ${(termLife / income).toFixed(0)}× your income`, detail: "Within the usual 10–15× guidance." });
    }
  }

  const upcoming = policies
    .filter((p) => p.renewalDate)
    .map((policy) => ({ policy, days: daysUntil(policy.renewalDate!, today) }))
    .filter((r) => r.days >= -30)
    .sort((a, b) => a.days - b.days)[0];

  return {
    health,
    termLife,
    yearlyPremium: sum(() => true, (p) => p.premium),
    healthPremium: sum((p) => p.type === "health", (p) => p.premium),
    annualIncome: income,
    checks,
    nextRenewal: upcoming,
  };
}
