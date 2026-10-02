import { Fragment, useEffect, useMemo, useState } from "react";
import { InfoIcon } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ViewProps } from "@/App";
import { groupSchemes, type SchemeGroup } from "@/lib/capitalGains";
import { day, money, monthLabel, pct } from "@/lib/format";
import { loadNavCache, type NavCache, type NavSeries } from "@/lib/nav";
import { netWorthHistory } from "@/lib/networthHistory";
import { valueHistory } from "@/lib/performance";
import { schemeKey } from "@/lib/portfolio";
import { cn } from "@/lib/utils";
import LineChart from "./LineChart";
import SectionCard from "./SectionCard";

const RANGES = [
  { value: 12, label: "1 year" },
  { value: 0, label: "All" },
] as const;

const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${money(Math.abs(n))}`;

/** Net worth at each month-end, rebuilt from fund NAVs, bank balances and the balances in your passbooks and statements. */
export default function NetWorthHistory({ store, data }: Pick<ViewProps, "store" | "data">) {
  const today = new Date().toISOString().slice(0, 10);
  const [cache, setCache] = useState<NavCache | null>(null);
  const [range, setRange] = useState<number>(12);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadNavCache(store).then(
      (c) => live && setCache(c),
      (e) => {
        toast.error("Couldn't read cached NAVs", { description: (e as Error).message });
        if (live) setCache({ codes: {}, series: new Map() });
      },
    );
    return () => {
      live = false;
    };
  }, [store]);

  const groups = useMemo(() => groupSchemes(data.statements), [data.statements]);
  const mf = useMemo(() => {
    if (!cache || !groups.length) return null;
    const navOf = (g: SchemeGroup): NavSeries | undefined => {
      const entry = cache.codes[schemeKey(g.name)];
      return entry ? cache.series.get(entry.code) : undefined;
    };
    return valueHistory(groups, navOf, today);
  }, [cache, groups, today]);

  const history = useMemo(() => (cache || !groups.length ? netWorthHistory(data, mf?.points ?? null, today) : null), [cache, groups.length, data, mf, today]);
  if (!history || history.points.length < 2) return null;

  const all = history.points;
  const points = range ? all.slice(-(range + 1)) : all;
  const rows = [...points].map((p, i) => ({ p, prev: points[i - 1] })).reverse();
  const from = points[0];
  const last = points.at(-1)!;
  const change = last.netWorth - from.netWorth;
  const late = Object.entries(history.trackedFrom).filter(([, d]) => d > all[0].date && d <= last.date).sort((a, b) => a[1].localeCompare(b[1]));

  return (
    <SectionCard
      title="Net worth over time"
      subtitle={`Month-ends, ${monthLabel(from.date.slice(0, 7))} to ${last.date === today ? "today" : day(last.date)}`}
      description={`${signed(change)} over this period${from.netWorth > 0 ? ` (${pct(change / from.netWorth)})` : ""}. Includes money you saved as well as market growth.`}
      action={
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => setRange(r.value)}
              className={cn("rounded-md px-2.5 py-1 text-xs", range === r.value ? "bg-secondary font-semibold" : "text-muted-foreground hover:bg-accent")}
            >
              {r.label}
            </button>
          ))}
        </div>
      }
    >
      <div className="space-y-4">
        <LineChart
          label="Net worth"
          series={[
            { key: "nw", label: "Net worth", color: "var(--chart-1)", points: points.map((p) => ({ date: p.date, v: p.netWorth })) },
            { key: "assets", label: "Assets", color: "var(--chart-3)", dashed: true, points: points.map((p) => ({ date: p.date, v: p.totalAssets })) },
          ]}
        />

        {(late.length > 0 || (mf && mf.missing.length > 0)) && (
          <div className="flex gap-3 rounded-lg border px-3 py-2.5 text-xs text-muted-foreground">
            <InfoIcon className="mt-0.5 size-4 shrink-0" />
            <div className="space-y-1">
              {late.length > 0 && (
                <p>
                  Earlier months leave out what wasn't tracked yet: {late.map(([g, d]) => `${g} (from ${monthLabel(d.slice(0, 7))})`).join(", ")}. A jump when something starts is that item
                  being added, not necessarily growth.
                </p>
              )}
              {mf && mf.missing.length > 0 && (
                <p>
                  {mf.missing.length} mutual fund scheme{mf.missing.length === 1 ? " has" : "s have"} no NAV history and {mf.missing.length === 1 ? "is" : "are"} left out of the past months. Refresh NAVs on Mutual funds → Performance.
                </p>
              )}
              {!mf && groups.length > 0 && <p>Mutual fund NAVs aren't loaded, so past fund values are missing.</p>}
            </div>
          </div>
        )}

        <Card className="py-0">
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Month end</TableHead>
                  <TableHead className="text-right">Assets</TableHead>
                  <TableHead className="text-right">Liabilities</TableHead>
                  <TableHead className="text-right">Net worth</TableHead>
                  <TableHead className="pr-4 text-right">Change</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ p, prev }) => {
                  const d = prev ? p.netWorth - prev.netWorth : null;
                  const expanded = open === p.date;
                  return (
                    <Fragment key={p.date}>
                      <TableRow className="cursor-pointer" onClick={() => setOpen(expanded ? null : p.date)}>
                        <TableCell className="pl-4">{p.date === today ? "Today" : day(p.date)}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(p.totalAssets)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{p.totalLiabilities ? money(p.totalLiabilities) : "—"}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{money(p.netWorth)}</TableCell>
                        <TableCell className={cn("pr-4 text-right tabular-nums", d != null && (d > 0 ? "text-positive" : d < 0 ? "text-destructive" : undefined))}>{d == null ? "—" : signed(d)}</TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableCell colSpan={5} className="pl-4 whitespace-normal">
                            <div className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
                              {[...Object.entries(p.assets).sort((a, b) => b[1] - a[1]), ...Object.entries(p.liabilities).map(([g, v]) => [g, -v] as const)].map(([g, v]) => (
                                <div key={g} className="flex justify-between gap-4">
                                  <span className="text-muted-foreground">{g}</span>
                                  <span className="tabular-nums">{v < 0 ? `−${money(-v)}` : money(v)}</span>
                                </div>
                              ))}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </SectionCard>
  );
}
