import { describe, expect, it } from "vitest";
import { maxDrawdown, portfolioReturns, riskStats, rollingReturns, type NavPoint } from "./risk";

const navs = (...v: number[]): NavPoint[] => v.map((nav, i) => ({ date: `${2020 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-28`, nav }));

describe("maxDrawdown", () => {
  const pts = [100, 120, 90, 110, 130, 100].map((v, i) => ({ date: `2020-0${i + 1}-28`, v }));
  it("finds the worst peak-to-trough fall", () => {
    const d = maxDrawdown(pts)!;
    expect(d.depth).toBeCloseTo(-0.25);
    expect(d.peak).toBe("2020-02-28");
    expect(d.trough).toBe("2020-03-28");
    expect(d.recovered).toBe(true);
  });
  it("flags a drawdown that hasn't recovered", () => {
    expect(maxDrawdown([100, 80, 90].map((v, i) => ({ date: `2020-0${i + 1}-28`, v })))!.recovered).toBe(false);
  });
  it("is zero for a steady climb", () => {
    expect(maxDrawdown([1, 2, 3].map((v, i) => ({ date: `2020-0${i + 1}-28`, v })))!.depth).toBe(0);
  });
});

describe("rollingReturns", () => {
  // 1% a month for 30 months.
  const grow = navs(...Array.from({ length: 30 }, (_, i) => 100 * 1.01 ** i));
  it("annualises each window", () => {
    const r = rollingReturns(grow, 1)!;
    expect(r.n).toBe(18);
    expect(r.median).toBeCloseTo(1.01 ** 12 - 1, 6);
    expect(r.positive).toBe(1);
    expect(r.beat).toBeNull();
  });
  it("needs more history than the window", () => {
    expect(rollingReturns(grow, 3)).toBeNull();
  });
});

describe("riskStats", () => {
  const bench = Array.from({ length: 24 }, (_, i) => (i % 2 ? -0.02 : 0.03));
  it("recovers beta 2 and zero alpha for a 2x levered benchmark", () => {
    const rfm = 1.065 ** (1 / 12) - 1;
    const fund = bench.map((b) => rfm + 2 * (b - rfm));
    const s = riskStats(fund, bench)!;
    expect(s.beta).toBeCloseTo(2, 6);
    expect(s.alpha).toBeCloseTo(0, 6);
  });
  it("gives no Sortino when nothing falls below the risk-free rate", () => {
    const s = riskStats(Array.from({ length: 24 }, (_, i) => 0.02 + (i % 2) * 0.01), null)!;
    expect(s.sortino).toBeNull();
    expect(s.sharpe).toBeGreaterThan(0);
  });
  it("needs a year of returns", () => {
    expect(riskStats([0.01, 0.02], null)).toBeNull();
  });
});

describe("portfolioReturns", () => {
  it("strips out new money so a deposit isn't a gain", () => {
    const r = portfolioReturns([
      { date: "2020-01-31", value: 100, invested: 100 },
      { date: "2020-02-29", value: 210, invested: 200 },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].r).toBeCloseTo(10 / 150, 6);
  });
});
