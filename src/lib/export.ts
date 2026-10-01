// "Export for AI": turns everything Leaf holds into files an AI chat assistant can analyse.
//
// Flat tables (transactions, fund holdings, gain lots) are CSV: far fewer tokens than JSON and they load straight
// into pandas. Small nested data is one JSON file. A README explains the columns, because without it the
// assistant has to guess what e.g. `direction` or `balance_after` mean. Secrets in config.json are never exported.

import type { InstrumentKind, MFTransaction, Transaction } from "@/types";
import { capitalGains, gainYears, groupSchemes, summarizeFY, type SchemeGroup } from "./capitalGains";
import type { LeafData } from "./db";
import type { GitHubStore } from "./github/store";
import { projectGoal } from "./goals";
import { costs, loadHoldings, lookThrough, overlaps, type FundHoldings, type FundInput } from "./holdings";
import { cardRecords, instrumentKey, instruments, KIND_LABEL, sourceStatus } from "./instruments";
import { DEFAULT_BENCHMARK, loadNavCache, navOn, type CodeMap, type NavSeries } from "./nav";
import { computeNetWorth } from "./networth";
import { compareBenchmark, valueHistory } from "./performance";
import { planMix, planTypeOf } from "./planType";
import { pnl as computePnL } from "./pnl";
import { assetClassOf, breakdown, latestStatements, schemeKey, summarize } from "./portfolio";
import { rebalance, type Targets } from "./rebalance";
import { sips } from "./sips";
import { zip } from "./zip";

export interface ExportOptions {
  /** Keep only transactions on or after this date (YYYY-MM-DD). Holdings and balances are always current. */
  from?: string;
  /** Drop folio numbers, PAN, e-mail addresses, account references and the insured person's name. */
  redact: boolean;
  today: string;
}

export interface ExportFile {
  name: string;
  content: string;
}

/** Data that lives in separate files of the repo (fund portfolios, NAV history) rather than in `LeafData`. */
export interface ExportExtras {
  codes: CodeMap;
  holdings: Map<number, FundHoldings>;
  navs: Map<number, NavSeries>;
}

export async function loadExportExtras(store: GitHubStore, data: LeafData): Promise<ExportExtras> {
  const { codes, series } = await loadNavCache(store, [data.config.benchmark ?? DEFAULT_BENCHMARK]);
  const holdings = await loadHoldings(store, Object.values(codes).map((c) => c.code));
  return { codes, holdings, navs: series };
}

type Cell = string | number | boolean | null | undefined;

const cell = (v: Cell) => {
  if (v == null) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(Math.round(v * 1e6) / 1e6) : "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const csv = (header: string[], rows: Cell[][]) => [header, ...rows].map((r) => r.map(cell).join(",")).join("\n") + "\n";

const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

/** Rough token count (about 4 characters each), enough to tell whether it fits a chat. */
export const estimateTokens = (files: ExportFile[]) => Math.ceil(files.reduce((s, f) => s + f.content.length, 0) / 4);

export function buildExport(data: LeafData, opts: ExportOptions, extras?: ExportExtras): ExportFile[] {
  const { redact, today } = opts;
  const inRange = (date: string) => !opts.from || date >= opts.from;
  const files: ExportFile[] = [];
  const add = (name: string, content: string) => files.push({ name, content });

  // ---- Bank & card transactions ----
  const sources = instruments(data.transactions, data.config, cardRecords(data.cardStatements, data.cardPayments));
  const sourceByKey = new Map(sources.map((s) => [s.key, s]));
  const txns = data.transactions.filter((t) => inRange(t.date)).sort((a, b) => b.date.localeCompare(a.date) || (b.source.receivedAt ?? "").localeCompare(a.source.receivedAt ?? ""));
  const sourceOf = (t: Transaction) => sourceByKey.get(instrumentKey(t) ?? "");
  add(
    "transactions.csv",
    csv(
      ["date", "direction", "amount", "currency", "description", "category", "note", "payment_source", "source_type", "balance_after"],
      txns.map((t) => {
        const src = sourceOf(t);
        return [t.date, t.direction, t.amount, t.currency, t.description, t.category, t.note, src?.label ?? t.instrument, src ? KIND_LABEL[src.kind] : t.instrumentKind && KIND_LABEL[t.instrumentKind as InstrumentKind], t.balanceAfter];
      }),
    ),
  );

  const monthly = new Map<string, { total: number; count: number }>();
  for (const t of txns) {
    const k = `${t.date.slice(0, 7)}|${t.direction}|${t.category || "Uncategorised"}`;
    const m = monthly.get(k) ?? { total: 0, count: 0 };
    m.total += t.amount;
    m.count++;
    monthly.set(k, m);
  }
  add(
    "monthly_summary.csv",
    csv(
      ["month", "direction", "category", "total", "count"],
      [...monthly].sort((a, b) => b[0].localeCompare(a[0])).map(([k, v]) => [...k.split("|"), round(v.total), v.count]),
    ),
  );

  // ---- Mutual funds ----
  const mf = summarize(data.statements);
  const cg = capitalGains(data.statements);
  const pnl = computePnL(data.statements, cg);
  add(
    "mf_holdings.csv",
    csv(
      ["scheme", "amc", "asset_class", "equity_style", "plan_type", "isin", "units", "nav", "value", "cost", "gain", "gain_pct", "xirr_pct", "history_complete", "realised_gain", "dividends", "as_of", ...(redact ? [] : ["folios"])],
      mf.schemes
        .filter((s) => s.units > 0.0001)
        .map((s) => [
          s.name, s.amc, s.assetClass, s.equityStyle, planTypeOf(s), s.isin, s.units, s.nav, round(s.value), round(s.cost), round(s.value - s.cost),
          s.cost ? round(((s.value - s.cost) / s.cost) * 100) : null, s.xirr == null ? null : round(s.xirr * 100), s.fullHistory,
          round(pnl.byScheme.get(schemeKey(s.name))?.realised ?? 0), round(pnl.byScheme.get(schemeKey(s.name))?.dividends ?? 0), s.asOf,
          ...(redact ? [] : [s.folios.join(" ")]),
        ]),
    ),
  );
  const mfTxn = (scheme: string, amc: string, t: MFTransaction) => [t.date, scheme, amc, t.type, t.amount, t.units, t.nav, t.description];
  add(
    "mf_transactions.csv",
    csv(
      ["date", "scheme", "amc", "type", "amount", "units", "nav", "description"],
      mf.schemes.flatMap((s) => s.transactions.filter((t) => inRange(t.date)).map((t) => mfTxn(s.name, s.amc, t))).sort((a, b) => String(b[0]).localeCompare(String(a[0]))),
    ),
  );

  const sipSummary = sips(data.statements);
  add(
    "sips.csv",
    csv(
      ["scheme", "amc", ...(redact ? ["stream"] : ["folio"]), "due_day", "cadence", "active", "monthly_amount", "last_amount", "instalments", "total_invested", "first", "last", "next", "missed_months", "bounced", "step_ups"],
      sipSummary.plans.flatMap((p) =>
        p.streams.map((s, i) => [
          p.scheme, p.amc, redact ? `SIP ${i + 1}` : s.folio, s.day, s.cadence, s.active, round(s.monthly), s.amount, s.count, round(s.invested), s.first, s.last, s.next,
          s.missed.join(" "), s.bounced.map((b) => `${b.date}:${b.amount}`).join(" "), s.stepUps.map((u) => `${u.date}:${u.from}->${u.to}`).join(" "),
        ]),
      ),
    ),
  );

  add(
    "capital_gains.csv",
    csv(
      ["fy", "scheme", "regime", "buy_date", "sell_date", "units", "cost", "proceeds", "gain", "term", "days_held", "grandfathering_applies"],
      cg.lots.map((l) => [l.fy, l.scheme, l.regime, l.buyDate, l.sellDate, l.units, round(l.cost), round(l.proceeds), round(l.gain), l.term, l.days, l.grandfathering]).sort((a, b) => String(b[3]).localeCompare(String(a[3]))),
    ),
  );

  // ---- Fund-level analysis: needs the cached portfolios and NAV history ----
  const groups = groupSchemes(data.statements);
  const asOf = latestStatements(data.statements).map((st) => st.statementPeriod.to).sort().at(-1) ?? "";
  const heldSchemes = mf.schemes.filter((s) => s.units > 0.0001);
  let fundAnalysis: object | undefined;
  if (extras) {
    const codeOf = (name: string) => extras.codes[schemeKey(name)]?.code;
    const navOfGroup = (g: SchemeGroup) => {
      const c = codeOf(g.name);
      return c == null ? undefined : extras.navs.get(c);
    };
    const funds: FundInput[] = heldSchemes.flatMap((s) => {
      const code = codeOf(s.name);
      const fund = code == null ? undefined : extras.holdings.get(code);
      return fund ? [{ name: s.name, value: s.value, fund }] : [];
    });

    const cagr = (nav: NavSeries | undefined, years: number) => {
      if (!nav || !asOf) return null;
      const start = new Date(`${asOf}T00:00:00Z`);
      start.setUTCFullYear(start.getUTCFullYear() - years);
      const from = start.toISOString().slice(0, 10);
      if (!nav.data[0] || nav.data[0][0] > from) return null;
      const a = navOn(nav, from);
      const b = navOn(nav, asOf);
      return a && b ? round((Math.pow(b / a, 1 / years) - 1) * 100) : null;
    };
    const cost = costs(funds, mf.value);
    const costOf = new Map(cost.rows.map((r) => [r.name, r]));
    add(
      "fund_info.csv",
      csv(
        ["scheme", "value", "category", "sub_category", "aum_cr", "expense_ratio_pct", "annual_cost", "portfolio_date", "holdings_from_direct_twin", "return_1y_pct", "return_3y_cagr_pct", "return_5y_cagr_pct"],
        heldSchemes.map((s) => {
          const code = codeOf(s.name);
          const f = code == null ? undefined : extras.holdings.get(code);
          const nav = code == null ? undefined : extras.navs.get(code);
          const c = costOf.get(s.name);
          return [s.name, round(s.value), f?.category, f?.subCategory, f?.aumCr, f?.expenseRatio, c?.annual == null ? null : round(c.annual), f?.portfolioDate, f?.holdingsFrom ? true : null, cagr(nav, 1), cagr(nav, 3), cagr(nav, 5)];
        }),
      ),
    );
    add(
      "fund_holdings.csv",
      csv(["scheme", "holding", "sector", "type", "weight_pct"], funds.flatMap(({ name, fund }) => fund.holdings.map((h) => [name, h.name, h.sector, h.type, h.weight]))),
    );
    const pairs = overlaps(funds);
    add(
      "fund_overlap.csv",
      csv(
        ["fund_a", "fund_b", "overlap_pct", "shared_stocks", "top_shared_stocks"],
        pairs.map((p) => [p.a, p.b, round(p.overlap), p.shared.length, p.shared.slice(0, 10).map((x) => `${x.name} (${x.a}%/${x.b}%)`).join("; ")]),
      ),
    );
    const look = lookThrough(funds, mf.value);
    add(
      "stock_exposure.csv",
      csv(
        ["stock", "sector", "amount", "share_of_mf_portfolio_pct", "held_via"],
        look.stocks.map((x) => [x.name, x.sector, round(x.amount), round(x.share * 100), x.funds.map((f) => `${f.name}: ${round(f.amount)}`).join("; ")]),
      ),
    );
    add("sector_exposure.csv", csv(["sector", "amount", "share_of_mf_portfolio_pct"], look.sectors.map((x) => [x.sector, round(x.amount), round(x.share * 100)])));

    const hist = asOf ? valueHistory(groups, navOfGroup, asOf) : { points: [], missing: [] };
    add("mf_value_history.csv", csv(["month_end", "value", "net_invested"], hist.points.map((p) => [p.date, round(p.value), round(p.invested)])));
    const bench = extras.navs.get(data.config.benchmark ?? DEFAULT_BENCHMARK);
    const equityGroups = groups.filter((g) => assetClassOf(g.name, g.reported) === "Equity");
    const cmp = bench && asOf ? compareBenchmark(equityGroups, bench, navOfGroup, asOf) : null;
    fundAnalysis = {
      look_through: { top10_share_pct: round(look.top10Share * 100), coverage_pct: round(look.coverage * 100), note: "Share of portfolio value held in funds whose portfolio is known" },
      costs: { weighted_expense_ratio_pct: cost.weighted == null ? null : round(cost.weighted), annual_cost: round(cost.annual), coverage_pct: round(cost.coverage * 100) },
      benchmark_comparison: cmp && {
        benchmark: bench!.name,
        scope: "equity schemes with full history; the same purchases put into the benchmark instead",
        from: cmp.from, invested: round(cmp.invested), your_value: round(cmp.mineValue), benchmark_value: round(cmp.benchValue),
        your_xirr_pct: cmp.mine == null ? null : round(cmp.mine * 100), benchmark_xirr_pct: cmp.bench == null ? null : round(cmp.bench * 100),
        excluded_schemes: cmp.excluded,
      },
      schemes_without_nav_history: hist.missing,
    };
  }

  // ---- Everything else: small and nested, so one JSON file ----
  const nw = computeNetWorth(data, today);
  const line = (l: (typeof nw.assets)[number]) => ({ label: l.label, group: l.group, value: round(l.value), as_of: l.asOf, stale: l.stale, note: l.note });
  const mask = <T extends object>(o: T, ...keys: string[]) => (redact ? Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k))) : o);
  const noSource = <T extends { source?: unknown }>(o: T) => {
    const { source: _s, ...rest } = o;
    return rest;
  };

  add(
    "wealth.json",
    JSON.stringify(
      {
        as_of: today,
        currency: "INR",
        net_worth: { total: round(nw.total), assets: nw.assets.map(line), liabilities: nw.liabilities.map(line), bank_accounts_without_balance: nw.missingBalances },
        mutual_fund_totals: { value: round(mf.value), cost: round(mf.cost), xirr_pct: mf.xirr == null ? null : round(mf.xirr * 100), xirr_coverage: round(mf.xirrCoverage, 2), as_of: mf.asOf, history_from: mf.historyFrom },
        mutual_fund_allocation: {
          by_asset_class: breakdown(heldSchemes, (x) => x.assetClass).map((x) => ({ asset_class: x.key, value: round(x.value), share_pct: round(x.share * 100) })),
          by_equity_style: breakdown(heldSchemes, (x) => x.equityStyle).map((x) => ({ style: x.key, value: round(x.value), share_pct: round(x.share * 100) })),
          direct_vs_regular: (({ by, dragLow, dragHigh }) => ({ direct: round(by.Direct), regular: round(by.Regular), unknown: round(by.Unknown), est_annual_commission_low: round(dragLow), est_annual_commission_high: round(dragHigh) }))(planMix(heldSchemes)),
          rebalance_vs_targets: data.config.rebalanceTargets
            ? rebalance(heldSchemes, data.config.rebalanceTargets as Targets).map((r) => ({ asset_class: r.cls, value: round(r.value), share_pct: round(r.share * 100), target_pct: r.target, drift_pct_points: round(r.drift, 1), buy_or_sell_to_target: round(r.toTarget) }))
            : undefined,
        },
        fund_analysis: fundAnalysis,
        sip_totals: { active_sips: sipSummary.activeSips, monthly_outflow: round(sipSummary.monthlyOutflow) },
        capital_gains_by_fy: gainYears(cg).map((fy) => {
          const s = summarizeFY(cg, fy);
          return { fy, equity_short_term: round(s.equityShort), equity_long_term: round(s.equityLong), debt_gold_short_term: round(s.otherShort), debt_gold_long_term: round(s.otherLong), ltcg_exemption: s.exemption, estimated_equity_tax: round(s.equityTax), proceeds: round(s.proceeds), cost: round(s.cost), unmatched_sale_proceeds: round(s.unmatched) };
        }),
        goals: (data.config.goals ?? []).map((g) => {
          const p = projectGoal(g, mf.schemes, sipSummary.plans, today);
          return { name: g.name, target: g.target, date: g.date, assumed_return_pct: g.returnPct, linked_schemes: g.schemes, current_value: round(p.current), monthly_contribution: round(p.monthly), contribution_from_sips: p.fromSips, projected_value: round(p.projected), required_monthly: round(p.required), on_track: p.onTrack };
        }),
        rebalance_targets_pct: data.config.rebalanceTargets,
        payment_sources: sources.map((s) => {
          const st = sourceStatus(s.key, data.transactions, data.cardStatements, data.cardPayments, today);
          return { name: s.label, type: KIND_LABEL[s.kind], transactions: s.count, last_used: s.lastUsed, balance: st.balance?.amount, balance_as_of: st.balance?.asOf };
        }),
        credit_card_statements: data.cardStatements.map((s) => ({ card: sourceByKey.get(s.card)?.label ?? s.card, statement_date: s.statementDate, total_due: s.totalDue, min_due: s.minDue, due_date: s.dueDate })),
        credit_card_payments: data.cardPayments.map((p) => ({ card: sourceByKey.get(p.card)?.label ?? p.card, date: p.date, amount: p.amount, via: p.via })),
        tracked_accounts: data.wealthAccounts.map((a) => mask(a, "ref")),
        account_snapshots: data.wealthSnapshots.map(noSource),
        account_flows: data.wealthFlows.map(noSource),
        payslips: data.payslips.map(noSource),
        tax_documents: data.taxDocs.map(noSource),
        insurance: data.policies.map((p) => mask(noSource(p), "policyRef", "insured")),
        categories: [...new Set(data.transactions.map((t) => t.category).filter(Boolean))].sort(),
      },
      null,
      1,
    ) + "\n",
  );

  return [readme(data, opts, files, txns.length), ...files];
}

function readme(data: LeafData, opts: ExportOptions, files: ExportFile[], txnCount: number): ExportFile {
  const rows = (name: string) => Math.max(0, (files.find((f) => f.name === name)?.content.split("\n").length ?? 1) - 2);
  const has = (n: string) => files.some((f) => f.name === n);
  const extrasRows = has("fund_info.csv")
    ? `| fund_info.csv | ${rows("fund_info.csv")} | Per fund: category, AUM, expense ratio, annual cost in rupees, 1/3/5-year returns |
| fund_holdings.csv | ${rows("fund_holdings.csv")} | What each fund owns (stocks and debt/cash instruments, weight as % of the fund) |
| fund_overlap.csv | ${rows("fund_overlap.csv")} | Pairs of funds sharing stocks; \`overlap_pct\` is the sum of the smaller weight of each shared stock |
| stock_exposure.csv | ${rows("stock_exposure.csv")} | Look-through: rupees in each stock after adding it up across all funds |
| sector_exposure.csv | ${rows("sector_exposure.csv")} | The same by sector |
| mf_value_history.csv | ${rows("mf_value_history.csv")} | Month-end portfolio value (units x NAV) against net money put in |
`
    : "";
  const dates = data.transactions.filter((t) => !opts.from || t.date >= opts.from).map((t) => t.date).sort();
  const content = `# Leaf export: personal finance data

Exported ${opts.today} from Leaf, a personal finance tracker built from bank/card e-mail alerts, mutual fund CAS statements and imported documents (payslips, NPS/EPF/PPF statements, insurance, Form 16). All amounts are in INR unless a row says otherwise. Dates are YYYY-MM-DD.
${opts.redact ? "Identifiers (PAN, folio numbers, account references, insured name) were removed. Payee names in transaction descriptions are as the bank reported them.\n" : "This export includes folio numbers and account references.\n"}
Transactions cover ${dates[0] ?? "n/a"} to ${dates.at(-1) ?? "n/a"} (${txnCount} rows). Fund holdings, balances and net worth are the latest known values.

## Files

| File | Rows | What it is |
|---|---|---|
| transactions.csv | ${rows("transactions.csv")} | Every bank/card alert, newest first |
| monthly_summary.csv | ${rows("monthly_summary.csv")} | Totals per month, direction and category (pre-computed from transactions.csv) |
| mf_holdings.csv | ${rows("mf_holdings.csv")} | Mutual fund schemes currently held |
| mf_transactions.csv | ${rows("mf_transactions.csv")} | Every mutual fund purchase, SIP, redemption, switch, dividend |
| sips.csv | ${rows("sips.csv")} | Detected SIPs, one row per SIP stream |
| capital_gains.csv | ${rows("capital_gains.csv")} | Realised mutual fund gains, FIFO-matched lots |
${extrasRows}| wealth.json | | Net worth, allocation, rebalancing drift, tracked accounts (EPF/PPF/NPS/FD/loans…), card bills, payslips, tax documents, insurance, goals, capital gains by FY, and fund costs/benchmark comparison when available |

## How to read the columns

- **transactions.csv**: \`direction\` is \`debit\` (money out) or \`credit\` (money in); \`amount\` is always positive. \`category\` is blank when uncategorised. \`balance_after\` is the account balance (bank) or available credit limit (card) the alert reported after the transaction, when it said. A credit card payment appears as a debit on the bank and may also appear as a credit on the card; do not count it as spending twice. \`payment_source\` is the card or account used.
- **mf_transactions.csv**: \`type\` is PURCHASE, PURCHASE_SIP, REDEMPTION, SWITCH_IN/OUT, DIVIDEND_PAYOUT/REINVEST, STAMP_DUTY, STT, TDS, REVERSAL (e.g. bounced SIP) or MISC. Amounts are positive; \`type\` gives the direction. Stamp duty/STT/TDS rows are charges, not investments.
- **mf_holdings.csv**: \`cost\` is the amount invested in units still held. \`xirr_pct\` is blank when the statements start after the first purchase (\`history_complete\` = false), because it can't be computed honestly.
- **Fund analysis files** (when present): fund portfolios are monthly disclosures, so \`portfolio_date\` can lag. Regular plans often borrow their Direct twin's holdings (\`holdings_from_direct_twin\`) and have no published expense ratio. Returns are point-to-point on NAV for Growth plans, not your own returns (those are \`xirr_pct\` in mf_holdings.csv). \`mf_value_history.csv\` omits schemes with no NAV history.
- **capital_gains.csv**: FIFO per scheme. Indexation and the 31-Jan-2018 grandfathering step-up are NOT applied (\`grandfathering_applies\` flags affected lots). \`regime\` is equity (long term after 12 months), other (debt/gold, 24 months) or slab (debt bought after 1 Apr 2023, always short term). Sales of units bought before the statements begin are excluded from the lots (see \`unmatched_sale_proceeds\` in wealth.json).
- **wealth.json**: \`account_snapshots\` are known values on a date; \`account_flows\` are contributions/withdrawals since. Values marked \`stale\` are over 100 days old. Net worth = assets - liabilities, where liabilities are loans and unpaid card dues.

## Caveats

- Data comes from e-mail alerts, so cash payments, accounts with no alerts and anything before Leaf started syncing are missing. Treat totals as lower bounds for spending.
- Categories were assigned by an AI model plus user rules and can be wrong.

## Questions worth asking

- Where does my money go each month, and which categories are growing fastest? Any subscriptions I forgot?
- What is my savings rate by month, accounting for salary arriving after the month it's for?
- Is my mutual fund portfolio well diversified across asset classes? Which funds underperform and are they worth keeping?
- Am I on track for my goals? What monthly SIP would get me there?
- How much tax will I owe on this year's realised gains, and which lots could I sell to stay within the LTCG exemption?
- Which funds overlap most, what do I really own after looking through them, and what are the fund costs costing me per year?
- Are my insurance covers adequate for my income and liabilities? Anything renewing soon?
`;
  return { name: "README.md", content };
}

/** One paste-able document: each file under a header, README first. */
export function bundleText(files: ExportFile[]): string {
  return files.map((f) => `=== ${f.name} ===\n${f.content.trimEnd()}\n`).join("\n");
}

export const zipFiles = (files: ExportFile[]) => zip(files);
