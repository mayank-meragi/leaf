import { describe, expect, it } from "vitest";
import type { InsurancePolicy, Payslip } from "@/types";
import { annualIncome, assessPolicy, coverage } from "./insurance";
import { toTerms } from "./ai/policy";

const src = { kind: "manual" } as const;
const health = (over: Partial<InsurancePolicy> = {}): InsurancePolicy => ({ insurer: "Acme", type: "health", cover: 1_000_000, premium: 20000, source: src, ...over });
const slip = (month: string, gross: number): Payslip => ({ month, employer: "E", gross, net: 0, tds: 0, pfEmployee: 0, pfEmployer: 0, source: src });

describe("assessPolicy", () => {
  it("separates good terms from things to watch, watch first", () => {
    const f = assessPolicy(health({ terms: { roomRent: { kind: "capped", detail: "1% of cover per day" }, coPayPct: 0, restore: true, waitingPreExistingMonths: 36, subLimits: ["Cataract: ₹40,000"] } }), "2026-10-02");
    expect(f.map((x) => [x.level, x.title])).toEqual([
      ["watch", "Room rent is capped"],
      ["watch", "Pre-existing diseases wait 36 months"],
      ["watch", "Sub-limits on treatments"],
      ["good", "No co-payment"],
      ["good", "Cover restores after a claim"],
    ]);
  });

  it("says nothing about terms the document didn't state, and warns of a near renewal", () => {
    expect(assessPolicy(health({ terms: {} }), "2026-10-02")).toEqual([]);
    const f = assessPolicy(health({ renewalDate: "2026-10-20" }), "2026-10-02");
    expect(f[0]).toMatchObject({ level: "watch", title: "Renews in 18 days" });
  });

  it("flags a co-payment with what it costs", () => {
    expect(assessPolicy(health({ terms: { coPayPct: 20 } }), "2026-10-02")[0].detail).toContain("₹1,00,000");
  });
});

describe("coverage", () => {
  it("checks health and term cover against guidance and income", () => {
    const c = coverage([health({ cover: 500_000 }), { ...health({ type: "term_life", cover: 5_000_000, premium: 12000 }) }], [slip("2026-09", 100_000)], "2026-10-02");
    expect(c).toMatchObject({ health: 500_000, termLife: 5_000_000, yearlyPremium: 32000, healthPremium: 20000, annualIncome: 1_200_000 });
    expect(c.checks.map((x) => x.level)).toEqual(["watch", "watch"]);
    expect(c.checks[1].title).toContain("4.2×");
  });

  it("annual income uses a year of payslips when there is one", () => {
    const slips = Array.from({ length: 12 }, (_, i) => slip(`2026-${String(i + 1).padStart(2, "0")}`, 100));
    expect(annualIncome(slips)).toBe(1200);
    expect(annualIncome([slip("2026-09", 50)])).toBe(600);
    expect(annualIncome([])).toBeUndefined();
  });
});

describe("toTerms", () => {
  it("keeps only what the document stated", () => {
    const t = toTerms({
      roomRentKind: "not_stated", roomRentDetail: "", coPayPct: -1, deductible: -1, waitingPreExistingMonths: 24, waitingSpecificMonths: -1, initialWaitingDays: 30,
      restore: "yes", noClaimBonusPct: 0, floater: "not_stated", cashless: "no", subLimits: [], exclusions: [],
    });
    expect(t).toEqual({ waitingPreExistingMonths: 24, initialWaitingDays: 30, restore: true, noClaimBonusPct: 0, cashless: false });
  });
});
