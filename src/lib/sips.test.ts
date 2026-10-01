import { describe, expect, it } from "vitest";
import type { CASStatement, MFTransaction, MFTxnType } from "@/types";
import { capitalGains } from "./capitalGains";
import { pnl } from "./pnl";
import { sips } from "./sips";

const tx = (type: MFTxnType, date: string, amount: number, units = amount / 10): MFTransaction => ({
  date,
  description: type,
  amount,
  units: type === "REVERSAL" || type === "REDEMPTION" ? -Math.abs(units) : units,
  nav: 10,
  balance: null,
  type,
});

const stmt = (to: string, schemes: Record<string, MFTransaction[]>, close = 0): CASStatement => ({
  statementPeriod: { from: "2024-01-01", to },
  investor: { pan: "ABCDE1234F" },
  folios: Object.entries(schemes).map(([name, txns], i) => ({
    folio: String(i),
    amc: "Test MF",
    schemes: [{ name, open: 0, close: close || txns.reduce((s, t) => s + (t.units ?? 0), 0), transactions: txns }],
  })),
  source: { kind: "upload", fileName: "t.pdf" },
  parsedAt: "",
});

const sip = (date: string, amount = 1000) => tx("PURCHASE_SIP", date, amount);

describe("sips", () => {
  it("finds an active monthly SIP with its step-up and next date", () => {
    const s = sips([stmt("2025-06-15", { "Alpha Flexi Cap Fund": [sip("2025-01-05"), sip("2025-02-05"), sip("2025-03-05", 1500), sip("2025-04-05", 1500), sip("2025-05-05", 1500), sip("2025-06-05", 1500)] })]);
    expect(s.plans).toHaveLength(1);
    expect(s.plans[0]).toMatchObject({ active: true, monthly: 1500, count: 6, invested: 8000, next: "2025-07-05", missed: [] });
    expect(s.plans[0].streams).toHaveLength(1);
    expect(s.plans[0].streams[0]).toMatchObject({ cadence: "Monthly", day: 5, amount: 1500 });
    expect(s.plans[0].stepUps).toEqual([{ date: "2025-03-05", from: 1000, to: 1500 }]);
    expect(s.monthlyOutflow).toBe(1500);
    expect(s.activeSips).toBe(1);
  });

  it("reports skipped months and treats a long silence as stopped", () => {
    const s = sips([stmt("2025-12-31", { "Beta Mid Cap Fund": [sip("2025-01-05"), sip("2025-02-05"), sip("2025-04-05"), sip("2025-05-05")] })]);
    expect(s.plans[0]).toMatchObject({ missed: ["2025-03"], active: false });
    expect(s.monthlyOutflow).toBe(0);
  });

  it("reports a bounced instalment instead of counting it", () => {
    const s = sips([
      stmt("2025-04-20", {
        "Gamma Small Cap Fund": [sip("2025-01-05"), sip("2025-02-05"), tx("REVERSAL", "2025-02-07", -1000), sip("2025-03-05"), sip("2025-04-05")],
      }),
    ]);
    expect(s.plans[0].count).toBe(3);
    expect(s.plans[0].bounced).toEqual([{ date: "2025-02-05", amount: 1000 }]);
    expect(s.plans[0].missed).toEqual([]);
  });

  it("ignores one-off purchases", () => {
    expect(sips([stmt("2025-04-20", { "Delta Fund": [tx("PURCHASE", "2025-01-05", 5000), sip("2025-02-05")] })]).plans).toEqual([]);
  });

  // Real pattern from a CAMS statement: one folio runs SIPs on the 1st, 7th and 15th, and an instalment due on a
  // weekend lands a few days late. Read as one stream the median gap is ~10 days ("Weekly"), the plan looks stopped,
  // and the monthly total is wrong.
  describe("several SIPs in one fund", () => {
    const months = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
    const txns = months.flatMap((m, i) => [
      sip(`${m}-01`, 2000), // due the 1st
      sip(`${m}-${i % 2 ? "09" : "07"}`, 4000), // due the 7th, sometimes processed on the 9th
      sip(`${m}-${i % 3 ? "15" : "17"}`, 5000), // due the 15th, sometimes the 17th
    ]);
    const s = sips([stmt("2026-09-30", { "Mirae Large and Midcap Fund": txns })]);

    it("tells the SIPs apart by day of month, tolerating holiday shifts", () => {
      expect(s.plans).toHaveLength(1);
      const st = s.plans[0].streams;
      expect(st).toHaveLength(3);
      expect(st.every((x) => x.cadence === "Monthly" && x.active && x.count === 6)).toBe(true);
      expect(new Set(st.map((x) => x.amount))).toEqual(new Set([2000, 4000, 5000]));
    });

    it("adds the running SIPs up for the monthly total, instead of the last instalment of one", () => {
      expect(s.plans[0].monthly).toBe(11_000);
      expect(s.monthlyOutflow).toBe(11_000);
      expect(s.activeSips).toBe(3);
      expect(s.plans[0].stepUps).toEqual([]); // alternating SIPs are not "step-ups"
    });

    it("keeps a stopped SIP out of the monthly total while the others run", () => {
      const stopped = txns.filter((t) => !(t.amount === 4000 && t.date > "2026-06-30"));
      const r = sips([stmt("2026-09-30", { "Mirae Large and Midcap Fund": stopped })]);
      expect(r.plans[0].streams.filter((x) => x.active)).toHaveLength(2);
      expect(r.plans[0].monthly).toBe(7_000);
      expect(r.plans[0].active).toBe(true);
    });

    it("anchors on the due day even when most instalments ran late", () => {
      // The 7th SIP was processed on the 9th in 5 of 6 months. It is still one SIP due on the 7th.
      const late = months.map((m, i) => sip(`${m}-${i === 0 ? "07" : "09"}`, 4000));
      const r = sips([stmt("2026-09-30", { "Late Fund": late })]);
      expect(r.plans[0].streams).toHaveLength(1);
      expect(r.plans[0].streams[0]).toMatchObject({ day: 9, count: 6, active: true, missed: [] });
    });

    it("flags one SIP skipping a month without disturbing the others", () => {
      const r = sips([stmt("2026-09-30", { "Mirae Large and Midcap Fund": txns.filter((t) => !(t.amount === 4000 && t.date.startsWith("2026-08"))) })]);
      expect(r.plans[0].missed).toEqual(["2026-08"]);
    });
  });

  describe("patterns seen in a real statement", () => {
    it("a skipped month doesn't turn a young SIP irregular, and is counted as missed", () => {
      // Started in June, skipped August: the gaps are 1 and 2 months. It is still a monthly SIP.
      const s = sips([stmt("2026-09-30", { "Young Fund": [sip("2026-06-08", 10_000), sip("2026-07-08", 10_000), sip("2026-09-08", 10_000)] })]);
      expect(s.plans[0].streams[0]).toMatchObject({ cadence: "Monthly", active: true, monthly: 10_000, missed: ["2026-08"] });
      expect(s.monthlyOutflow).toBe(10_000);
    });

    it("several SIPs on nearby days in one folio add up, instead of showing the last instalment alone", () => {
      // Three SIPs processed within a few days of each other every month: two of ₹5,000 and one of ₹3,000.
      const months = ["2026-06", "2026-07", "2026-08", "2026-09"];
      const t = months.flatMap((m) => [sip(`${m}-06`, 5000), sip(`${m}-08`, 5000), sip(`${m}-10`, 3000)]);
      const r = sips([stmt("2026-09-30", { "Busy Fund": t })]);
      expect(r.plans[0].streams).toHaveLength(1);
      expect(r.plans[0]).toMatchObject({ monthly: 13_000, sips: 3, active: true, missed: [], stepUps: [] });
      expect(r.activeSips).toBe(3);
    });

    it("counts each skipped instalment when only some SIPs in a stream run", () => {
      const months = ["2026-06", "2026-07", "2026-08", "2026-09"];
      const t = months.flatMap((m) => [sip(`${m}-06`, 5000), sip(`${m}-08`, 5000), sip(`${m}-10`, 3000)]).filter((x) => !(x.date.startsWith("2026-08") && x.amount === 5000));
      const r = sips([stmt("2026-09-30", { "Busy Fund": t })]);
      expect(r.plans[0].missed).toEqual(["2026-08", "2026-08"]);
      expect(r.plans[0].monthly).toBe(13_000); // typical, not the month that fell short
    });

    it("doesn't fault a SIP for months before an extra SIP was added", () => {
      const t = [sip("2026-05-06", 5000), sip("2026-06-06", 5000), sip("2026-07-06", 5000), sip("2026-07-08", 5000), sip("2026-08-06", 5000), sip("2026-08-08", 5000), sip("2026-09-06", 5000), sip("2026-09-08", 5000)];
      const r = sips([stmt("2026-09-30", { "Growing Fund": t })]);
      expect(r.plans[0].missed).toEqual([]);
      expect(r.plans[0].sips).toBe(2);
    });
  });

  it("keeps SIPs in different folios apart", () => {
    const mk = (folio: string, name: string) => ({ folio, amc: "T", schemes: [{ name, open: 0, close: 0, transactions: ["2026-07-15", "2026-08-15", "2026-09-15"].map((d) => sip(d, 3000)) }] });
    const st: CASStatement = { ...stmt("2026-09-30", {}), folios: [mk("111", "Same Fund"), mk("222", "Same Fund")] };
    const r = sips([st]);
    expect(r.plans).toHaveLength(1);
    expect(r.plans[0].streams.map((x) => x.folio).sort()).toEqual(["111", "222"]);
    expect(r.plans[0].monthly).toBe(6000);
  });
});

describe("pnl", () => {
  it("sums realised gains and dividends, including for exited schemes", () => {
    const st = stmt("2025-12-31", {
      "Zeta Flexi Cap Fund": [tx("PURCHASE", "2024-01-05", 1000), tx("REDEMPTION", "2025-02-05", -1500, 100)],
      "Eta Mid Cap Fund": [tx("PURCHASE", "2024-01-05", 1000), { ...tx("DIVIDEND_PAYOUT", "2025-01-01", 40), units: null }],
    });
    const p = pnl([st], capitalGains([st]));
    expect(p.realised).toBe(500);
    expect(p.dividends).toBe(40);
  });
});
