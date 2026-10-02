export interface MetricInfo {
  title: string;
  /** What it measures, in one or two plain sentences. */
  means: string;
  /** Rule-of-thumb range for a long-term Indian equity fund portfolio. */
  good: string;
  /** What can mislead. */
  caution?: string;
}

/** Plain-language notes behind the (i) buttons. Ranges are rules of thumb, not guarantees. */
export const METRICS = {
  xirr: {
    title: "XIRR",
    means: "Your actual annualised return, counting the date of every purchase and redemption. It's the one number that says how your money did, SIPs included.",
    good: "Long-run equity has given roughly 11–14% a year. Anything above ~8–9% (inflation plus a few points) is doing its job over 5+ years. Judge it against the index, not in isolation.",
    caution: "Needs full transaction history. Under about 1–2 years it swings wildly and isn't meaningful.",
  },
  benchmarkXirr: {
    title: "Versus the index",
    means: "Your exact purchases and redemptions replayed into an index fund. The gap is what your fund choices added or cost compared with just buying the index.",
    good: "Consistently +1 to +2 points a year ahead is good. Around 0 means an index fund would have done the same for less effort. Negative over 5+ years is a reason to question the fund.",
    caution: "Compare like with like: a mid-cap fund against the Nifty 50 will look better or worse mainly because of its category.",
  },
  rolling: {
    title: "Rolling returns",
    means: "The annualised return over every possible 1-, 3- or 5-year window, not just one start date. Shows how consistent a fund is, not just how it did from one lucky or unlucky day.",
    good: "Median 3-year of 12–15% for equity is solid. A worst window near or above 0%, and a high share of windows beating the index (above ~60%) show consistency. Check the spread between best and worst.",
    caution: "Windows overlap heavily, so 3 years of data is really only a handful of independent periods. Based on NAV, so payout (IDCW) plans look worse than they were.",
  },
  drawdown: {
    title: "Maximum drawdown",
    means: "The worst fall from a high to a later low. It's the loss you'd have felt if you'd bought at the top and held through the bottom.",
    good: "Large-cap equity funds typically fell 30–40% in the 2020 crash; mid and small caps 40–60%. Falling less than the index in the same period is good. If you couldn't sit through the number shown, your equity share is too high.",
    caution: "One event decides it. A short history that missed a crash will look deceptively mild.",
  },
  sharpe: {
    title: "Sharpe ratio",
    means: "Return above a risk-free rate for each unit of ups-and-downs (volatility). Higher means you were paid better for the bumpiness.",
    good: "Above 1 is good, 0.5–1 is fair, below 0.5 is weak. Compare funds of the same type, as equity funds sit lower in rising-rate or flat markets.",
    caution: "Uses the last 3 years of month-end NAVs and an assumed 6.5% risk-free rate. Treats up-moves as risk too, which is why Sortino exists.",
  },
  sortino: {
    title: "Sortino ratio",
    means: "Like Sharpe, but only counts downside swings as risk. A fund that mostly jumps up and rarely drops scores much better here than on Sharpe.",
    good: "Above 1.5 is good, 1–1.5 fair, below 1 weak. If Sortino is well above Sharpe, most of the volatility was upward.",
    caution: "Sensitive to a few bad months, so it needs 3+ years to mean much.",
  },
  beta: {
    title: "Beta",
    means: "How much the fund moves when the index moves. 1.0 moves with the market, 1.2 moves 20% more, 0.8 moves 20% less.",
    good: "About 0.9–1.1 for a core fund, below 0.9 for defensive, above 1.1 for aggressive. Neither is better: it should match the risk you meant to take.",
    caution: "Measured against the benchmark you pick, so a small-cap fund against the Nifty 50 will show a high beta that mostly reflects category.",
  },
  alpha: {
    title: "Alpha",
    means: "Return above what the fund's market exposure (beta) would suggest. Positive alpha means the manager added something beyond just riding the index.",
    good: "Above 0 is beating the market-adjusted bar; 2+ points a year is strong. Persistently negative means a cheap index fund would have served you better.",
    caution: "Noisy over 3 years and depends on the benchmark chosen. Treat it as a hint, and look for consistency across periods.",
  },
  overlap: {
    title: "Fund overlap",
    means: "How much of one fund's money sits in the same stocks as another's: for every shared stock, the smaller of its two weights, added up. 0% is completely different portfolios, 100% is identical.",
    good: "Under 20% is well differentiated, 20–35% is normal, 35–50% is meaningful, 50–70% is high, above 70% means the funds are doing nearly the same thing. Two index-style funds should overlap heavily; two funds bought for diversification shouldn't.",
    caution: "Some overlap is inevitable. Ask whether the second fund adds enough new exposure to justify holding it. Based on monthly disclosures, which lag by a month or two.",
  },
  portfolioOverlap: {
    title: "Portfolio overlap",
    means: "The average overlap across all your fund pairs, weighted by how much you hold in each. Two big positions that overlap count far more than a big one and a tiny one.",
    good: "Under about 30% is healthy. Above 40–50% suggests you own several funds that are really one portfolio. Compare it with the matrix to find which pair is responsible.",
    caution: "Don't chase the lowest possible number. A fund you hold for a different job (small cap next to a large cap) can overlap little and still be worth having.",
  },
  effectiveStocks: {
    title: "Effective number of stocks",
    means: "Your funds' combined holdings, collapsed to the number of equally sized stocks that would be just as concentrated (1 ÷ sum of squared weights). It cuts through hundreds of positions that are really the same big names.",
    good: "Higher is more diversified. 60+ is well spread for a mutual fund portfolio; under 30 means a few names dominate. Compare it with the number of unique stocks: a big gap means heavy concentration at the top.",
    caution: "Large-cap funds naturally put weight in the same top names, so a lower figure is partly the market's own structure.",
  },
  concentration: {
    title: "Concentration",
    means: "How much of your whole portfolio rides on a few stocks. Adding up every fund's holdings shows what you really own.",
    good: "Top 10 stocks under about 35–40% is well spread; above 60% is concentrated. Watch any single stock above ~8–10% and any sector above ~30%.",
    caution: "Large caps naturally dominate index-like funds, so some concentration is the market's own.",
  },
  expenseRatio: {
    title: "Expense ratio",
    means: "The yearly fee, deducted from the NAV every day. You never see a bill, but it comes straight out of your return, compounding over decades.",
    good: "Index funds: 0.1–0.3%. Active Direct equity funds: about 0.5–1.0%. Regular plans: often 1.5–2.2%. Over 20 years, a 1% fee gap can cost 15–20% of your final corpus.",
    caution: "Regular plans' ratios aren't published by the data source, so those funds can show n/a.",
  },
} satisfies Record<string, MetricInfo>;

export type MetricId = keyof typeof METRICS;
