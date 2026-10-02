import { useMemo, useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { SchemeGroup } from "@/lib/capitalGains";
import { day, pct } from "@/lib/format";
import type { MetricId } from "@/lib/metricInfo";
import type { NavSeries } from "@/lib/nav";
import { navOn } from "@/lib/nav";
import { valueHistory } from "@/lib/performance";
import { alignedReturns, indexOf, maxDrawdown, monthlyNavs, portfolioReturns, riskStats, rollingReturns, RISK_FREE, type Drawdown } from "@/lib/risk";
import { cn } from "@/lib/utils";
import InfoTip from "./InfoTip";
import SectionCard from "./SectionCard";

const WINDOW_MONTHS = 36;
const YEARS = [1, 3, 5] as const;

interface Props {
  groups: SchemeGroup[];
  navOf: (g: SchemeGroup) => NavSeries | undefined;
  bench: NavSeries | undefined;
  benchLabel: string;
  asOf: string;
}

const ratio = (n: number | null | undefined, digits = 2) => (n == null ? "—" : n.toFixed(digits));
const pts = (n: number | null | undefined) => (n == null ? "—" : `${n >= 0 ? "+" : "−"}${Math.abs(n * 100).toFixed(1)}`);
const pctPlain = (n: number) => pct(n).replace("+", "");

/** How consistent, how bumpy and how much risk-adjusted value, for the portfolio and each fund you hold. */
export default function Risk({ groups, navOf, bench, benchLabel, asOf }: Props) {
  const [years, setYears] = useState<(typeof YEARS)[number]>(3);

  const funds = useMemo(
    () =>
      groups
        .filter((g) => g.close > 1e-4)
        .flatMap((g) => {
          const series = navOf(g);
          if (!series) return [];
          const navs = monthlyNavs(series, asOf);
          const aligned = alignedReturns(navs, bench, WINDOW_MONTHS);
          return [
            {
              name: g.name,
              rolling: Object.fromEntries(YEARS.map((y) => [y, rollingReturns(navs, y, bench)])) as Record<number, ReturnType<typeof rollingReturns>>,
              drawdown: maxDrawdown(navs.map((p) => ({ date: p.date, v: p.nav }))),
              stats: riskStats(aligned.fund, aligned.bench),
            },
          ];
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    [groups, bench, asOf], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const portfolio = useMemo(() => {
    const hist = valueHistory(groups, navOf, asOf);
    const rets = portfolioReturns(hist.points);
    if (rets.length < 2) return null;
    const dd = maxDrawdown(indexOf(hist.points[0].date, rets));
    const tail = rets.slice(-WINDOW_MONTHS);
    const benchRets = bench ? tail.map((r) => benchReturn(bench, r.from, r.date)) : [];
    const b = bench && benchRets.every((x): x is number => x != null) ? benchRets : null;
    return { drawdown: dd, stats: riskStats(tail.map((r) => r.r), b), months: rets.length };
  }, [groups, bench, asOf]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!funds.length) return null;

  return (
    <SectionCard
      title="Risk and consistency"
      description={`How steadily each fund has delivered and how rough the ride was. Ratios use the last ${WINDOW_MONTHS} months against ${benchLabel} and an assumed ${(RISK_FREE * 100).toFixed(1)}% risk-free rate.`}
      bodyClassName="space-y-4"
    >
      {portfolio && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Tile id="drawdown" label="Worst fall" value={portfolio.drawdown && portfolio.drawdown.depth < 0 ? pctPlain(portfolio.drawdown.depth) : "—"} sub={ddSub(portfolio.drawdown)} />
          <Tile id="sharpe" label="Sharpe" value={ratio(portfolio.stats?.sharpe)} sub={rate(portfolio.stats?.sharpe, 1, 0.5)} />
          <Tile id="sortino" label="Sortino" value={ratio(portfolio.stats?.sortino)} sub={rate(portfolio.stats?.sortino, 1.5, 1)} />
          <Tile id="beta" label="Beta" value={ratio(portfolio.stats?.beta)} sub={portfolio.stats?.beta == null ? undefined : portfolio.stats.beta > 1.1 ? "Moves more than the index" : portfolio.stats.beta < 0.9 ? "Moves less than the index" : "Moves with the index"} />
          <Tile id="alpha" label="Alpha" value={portfolio.stats?.alpha == null ? "—" : `${pts(portfolio.stats.alpha)} pts`} sub="a year, vs the index" tone={portfolio.stats?.alpha} />
        </div>
      )}
      {!portfolio && <p className="text-sm text-muted-foreground">Portfolio-level ratios need a year or more of transactions with NAV history.</p>}

      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="mr-1 flex items-center gap-1 text-muted-foreground">
          Rolling return window <InfoTip id="rolling" />
        </span>
        {YEARS.map((y) => (
          <button key={y} type="button" onClick={() => setYears(y)} className={cn("rounded-md px-2.5 py-1 text-xs", years === y ? "bg-secondary font-semibold" : "text-muted-foreground hover:bg-accent")}>
            {y} year{y > 1 ? "s" : ""}
          </button>
        ))}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Fund</TableHead>
            <TableHead className="text-right">Median</TableHead>
            <TableHead className="text-right">Worst</TableHead>
            <TableHead className="text-right" title="Share of rolling windows that beat the index">
              Beat index
            </TableHead>
            <Head id="drawdown">Worst fall</Head>
            <Head id="sharpe">Sharpe</Head>
            <Head id="sortino">Sortino</Head>
            <Head id="beta">Beta</Head>
            <Head id="alpha">Alpha</Head>
          </TableRow>
        </TableHeader>
        <TableBody>
          {funds.map((f) => {
            const r = f.rolling[years];
            return (
              <TableRow key={f.name}>
                <TableCell className="whitespace-normal font-medium">{f.name}</TableCell>
                <TableCell className="text-right tabular-nums">{r ? pctPlain(r.median) : <Na why={`Less than ${years} year${years > 1 ? "s" : ""} of NAV history`} />}</TableCell>
                <TableCell className={cn("text-right tabular-nums", r && r.worst < 0 && "text-destructive")} title={r ? `Best ${pctPlain(r.best)} · ${r.n} windows · ${(r.positive * 100).toFixed(0)}% positive` : undefined}>
                  {r ? pctPlain(r.worst) : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">{r?.beat == null ? "—" : `${(r.beat * 100).toFixed(0)}%`}</TableCell>
                <TableCell className="text-right tabular-nums" title={f.drawdown && f.drawdown.depth < 0 ? `${day(f.drawdown.peak)} to ${day(f.drawdown.trough)}${f.drawdown.recovered ? "" : " (not yet recovered)"}` : undefined}>
                  {f.drawdown && f.drawdown.depth < 0 ? pctPlain(f.drawdown.depth) : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">{f.stats ? ratio(f.stats.sharpe) : <Na why="Needs 12+ months of NAV history" />}</TableCell>
                <TableCell className="text-right tabular-nums">{ratio(f.stats?.sortino)}</TableCell>
                <TableCell className="text-right tabular-nums">{ratio(f.stats?.beta)}</TableCell>
                <TableCell className={cn("text-right tabular-nums", f.stats?.alpha != null && (f.stats.alpha >= 0 ? "text-positive" : "text-destructive"))}>
                  {f.stats?.alpha == null ? "—" : pts(f.stats.alpha)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">
        Median and worst are annualised returns over every {years}-year window since launch. Worst fall covers the fund's whole NAV history; hover for dates. NAV-based, so payout (IDCW) plans understate returns. Beta and alpha
        compare every fund with the one index you picked above, so a mid- or small-cap fund will look aggressive against the Nifty 50.
      </p>
    </SectionCard>
  );
}

function benchReturn(bench: NavSeries, from: string, to: string): number | null {
  const a = navOn(bench, from);
  const b = navOn(bench, to);
  return a && b ? b / a - 1 : null;
}
function ddSub(d: Drawdown | null) {
  if (!d || d.depth >= 0) return undefined;
  return `${day(d.peak)} → ${day(d.trough)}${d.recovered ? "" : ", not recovered"}`;
}
const rate = (n: number | null | undefined, good: number, fair: number) => (n == null ? undefined : n >= good ? "Good" : n >= fair ? "Fair" : "Weak");

function Head({ id, children }: { id: MetricId; children: string }) {
  return (
    <TableHead className="text-right">
      <span className="inline-flex items-center justify-end gap-1">
        {children}
        <InfoTip id={id} />
      </span>
    </TableHead>
  );
}

function Na({ why }: { why: string }) {
  return (
    <span className="text-muted-foreground" title={why}>
      —
    </span>
  );
}

function Tile({ id, label, value, sub, tone }: { id: MetricId; label: string; value: string; sub?: string; tone?: number | null }) {
  return (
    <div className="rounded-lg border px-4 py-3">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        {label}
        <InfoTip id={id} />
      </div>
      <div className={cn("text-xl font-semibold tabular-nums", tone != null && (tone >= 0 ? "text-positive" : "text-destructive"))}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}
