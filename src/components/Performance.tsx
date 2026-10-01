import { useEffect, useMemo, useState } from "react";
import { DownloadCloudIcon, InfoIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ViewProps } from "@/App";
import { groupSchemes, type SchemeGroup } from "@/lib/capitalGains";
import { day, money, pct } from "@/lib/format";
import {
  BENCHMARKS,
  DEFAULT_BENCHMARK,
  loadNavCache,
  mfapi,
  resolveScheme,
  saveNavCache,
  type NavCache,
  type NavSeries,
} from "@/lib/nav";
import { compareBenchmark, valueHistory } from "@/lib/performance";
import { assetClassOf, latestStatements, schemeKey } from "@/lib/portfolio";
import { cn } from "@/lib/utils";
import LineChart from "./LineChart";

const DAY = 86_400_000;

export default function Performance({ store, data, setData }: Pick<ViewProps, "store" | "data" | "setData">) {
  const groups = useMemo(() => groupSchemes(data.statements), [data.statements]);
  const asOf = useMemo(() => latestStatements(data.statements).map((s) => s.statementPeriod.to).sort().at(-1) ?? "", [data.statements]);
  const benchmarkCode = data.config.benchmark ?? DEFAULT_BENCHMARK;

  const [cache, setCache] = useState<NavCache | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [equityOnly, setEquityOnly] = useState(true);

  useEffect(() => {
    let live = true;
    loadNavCache(store, [benchmarkCode]).then((c) => live && setCache(c), (e) => toast.error("Couldn't read cached NAVs", { description: (e as Error).message }));
    return () => {
      live = false;
    };
  }, [store, benchmarkCode]);

  const navOf = (g: SchemeGroup): NavSeries | undefined => {
    const entry = cache?.codes[schemeKey(g.name)];
    return entry ? cache!.series.get(entry.code) : undefined;
  };
  const bench = cache?.series.get(benchmarkCode);

  const history = useMemo(() => (cache && asOf ? valueHistory(groups, navOf, asOf) : null), [cache, groups, asOf]); // eslint-disable-line react-hooks/exhaustive-deps
  const compared = useMemo(
    () => (cache && bench && asOf ? compareBenchmark(equityOnly ? groups.filter((g) => assetClassOf(g.name, g.reported) === "Equity") : groups, bench, navOf, asOf) : null),
    [cache, bench, groups, asOf, equityOnly], // eslint-disable-line react-hooks/exhaustive-deps
  );

  /** Fetches whatever's missing or out of date, then commits it all at once. */
  const refresh = async () => {
    if (!cache) return;
    setBusy("Matching schemes…");
    try {
      const codes = { ...cache.codes };
      const series = new Map(cache.series);
      const changed = new Map<number, NavSeries>();
      const stale = (s?: NavSeries) => !s || (s.fetched < new Date().toISOString().slice(0, 10) && Date.parse(s.data.at(-1)?.[0] ?? "1970-01-01") < Date.parse(asOf) - 5 * DAY);
      const unmatched: string[] = [];

      for (const [i, g] of groups.entries()) {
        const key = schemeKey(g.name);
        setBusy(`${g.name} (${i + 1}/${groups.length})`);
        const known = codes[key];
        if (known && !stale(series.get(known.code))) continue;
        if (known) {
          const s = await mfapi.series(known.code);
          series.set(s.code, s);
          changed.set(s.code, s);
          continue;
        }
        const anchors = [
          ...(g.nav ? [{ date: g.asOf, nav: g.nav }] : []),
          ...g.txns.filter((t) => t.nav && t.units).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4).map((t) => ({ date: t.date, nav: t.nav! })),
        ];
        const found = await resolveScheme({ name: g.name, isin: g.isin, advisor: g.advisor, anchors });
        if (!found) {
          unmatched.push(g.name);
          continue;
        }
        codes[key] = { code: found.series.code, name: found.series.name, verified: found.verified };
        series.set(found.series.code, found.series);
        changed.set(found.series.code, found.series);
      }

      if (stale(series.get(benchmarkCode))) {
        setBusy("Benchmark…");
        const s = await mfapi.series(benchmarkCode);
        series.set(s.code, s);
        changed.set(s.code, s);
      }

      if (changed.size || Object.keys(codes).length !== Object.keys(cache.codes).length) {
        setBusy("Saving to your data repo…");
        await saveNavCache(store, codes, [...changed.values()], `Update NAV history (${changed.size} scheme${changed.size === 1 ? "" : "s"})`);
      }
      setCache({ codes, series });
      if (unmatched.length) toast.warning(`Couldn't match ${unmatched.length} scheme${unmatched.length === 1 ? "" : "s"} to AMFI`, { description: unmatched.join("; ") });
      else toast.success("NAV history is up to date");
    } catch (e) {
      toast.error("Couldn't update NAV history", { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const setBenchmark = async (code: number) => {
    const config = { ...data.config, benchmark: code };
    try {
      await store.writeJSON({ "config.json": config }, "Set benchmark");
      setData({ ...data, config });
    } catch (e) {
      toast.error("Couldn't save", { description: (e as Error).message });
    }
  };

  const unmatched = groups.filter((g) => cache && !navOf(g));
  const hasAny = cache && cache.codes && Object.keys(cache.codes).length > 0;
  const upToDate = Boolean(hasAny && !unmatched.length && bench);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <div className="space-y-1.5">
            <CardTitle>Value over time</CardTitle>
            <CardDescription>Units held at each month-end × that day's NAV, against the money you put in.</CardDescription>
          </div>
          <Button variant={upToDate ? "outline" : "default"} onClick={refresh} disabled={!cache || !!busy || !groups.length}>
            {busy ? <Loader2Icon className="animate-spin" /> : <DownloadCloudIcon />}
            {upToDate ? "Refresh NAVs" : hasAny ? "Fetch missing NAVs" : "Load NAV history"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {busy && <p className="text-sm text-muted-foreground">{busy}</p>}
          {history && history.points.length > 1 ? (
            <LineChart
              label="Portfolio value and net invested by month"
              series={[
                { key: "value", label: "Value", color: "var(--chart-1)", points: history.points.map((p) => ({ date: p.date, v: p.value })) },
                { key: "invested", label: "Net invested", color: "var(--chart-2)", dashed: true, points: history.points.map((p) => ({ date: p.date, v: p.invested })) },
              ]}
            />
          ) : (
            !busy && (
              <p className="text-sm text-muted-foreground">
                {cache ? "Load NAV history to chart your portfolio. It's fetched from AMFI's data via mfapi.in once and saved in your data repo under nav/." : "Reading saved NAVs…"}
              </p>
            )
          )}
          {history && history.missing.length > 0 && (
            <Note>
              No NAV history for {history.missing.length} scheme{history.missing.length === 1 ? "" : "s"}, so {history.missing.length === 1 ? "it isn't" : "they aren't"} in the chart:{" "}
              {history.missing.join("; ")}.
            </Note>
          )}
          {history && history.points.length > 1 && (
            <p className="text-xs text-muted-foreground">
              Net invested only counts transactions your statements show. Units bought before then are valued but have no cost in the dashed line.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <div className="space-y-1.5">
            <CardTitle>Versus the index</CardTitle>
            <CardDescription>Your actual purchases and redemptions, replayed into an index fund instead.</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Select value={equityOnly ? "equity" : "all"} onValueChange={(v) => setEquityOnly(v === "equity")}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="equity">Equity funds</SelectItem>
                <SelectItem value="all">All funds</SelectItem>
              </SelectContent>
            </Select>
            <Select value={String(benchmarkCode)} onValueChange={(v) => setBenchmark(Number(v))}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BENCHMARKS.map((b) => (
                  <SelectItem key={b.code} value={String(b.code)}>
                    {b.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {compared ? (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <Tile label="Your XIRR" value={compared.mine == null ? "—" : pct(compared.mine).replace("+", "")} sub={`${money(compared.mineValue)} today`} />
                <Tile label={`If in ${BENCHMARKS.find((b) => b.code === benchmarkCode)?.label ?? "the index"}`} value={compared.bench == null ? "—" : pct(compared.bench).replace("+", "")} sub={`${money(compared.benchValue)} today`} />
                <Tile
                  label="Difference"
                  value={compared.mine != null && compared.bench != null ? `${((compared.mine - compared.bench) * 100).toFixed(1)} pts` : "—"}
                  sub={compared.mine != null && compared.bench != null ? `${money(compared.mineValue - compared.benchValue)} ${compared.mineValue >= compared.benchValue ? "ahead" : "behind"}` : undefined}
                  tone={compared.mine != null && compared.bench != null ? compared.mine - compared.bench : undefined}
                />
              </div>
              {compared.benchStartsAfter ? (
                <Note>
                  This index fund's NAV history starts {day(compared.benchStartsAfter)}, but you invested from {day(compared.from)}. Pick an older benchmark (Nifty 50) for a fair comparison.
                </Note>
              ) : (
                compared.curve.length > 1 && (
                  <LineChart
                    label="Your value against the same cashflows in the benchmark"
                    series={[
                      { key: "mine", label: "Your funds", color: "var(--chart-1)", points: compared.curve.map((p) => ({ date: p.date, v: p.mine })) },
                      { key: "bench", label: "Same cashflows in index", color: "var(--chart-3)", dashed: true, points: compared.curve.map((p) => ({ date: p.date, v: p.bench })) },
                    ]}
                  />
                )
              )}
              <p className="text-xs text-muted-foreground">
                Covers {compared.schemes.length} fund{compared.schemes.length === 1 ? "" : "s"} with full history since {day(compared.from)}
                {compared.excluded.length > 0 && `; ${compared.excluded.length} more are left out because they were bought before your statements begin`}. Index fund NAVs are net of its small
                expense ratio, so the index itself would do slightly better.
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{bench ? "No fund with full history to compare yet." : "Load NAV history above to fetch the benchmark."}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: number }) {
  return (
    <div className="rounded-lg border px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("text-xl font-semibold tabular-nums", tone != null && (tone >= 0 ? "text-positive" : "text-destructive"))}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm">
      <InfoIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <p>{children}</p>
    </div>
  );
}
