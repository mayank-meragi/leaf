import { useMemo, useState } from "react";
import { InfoIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ViewProps } from "@/App";
import { amcLabel, day, money, pct } from "@/lib/format";
import { capitalGains } from "@/lib/capitalGains";
import { pnl as computePnL } from "@/lib/pnl";
import { schemeKey, summarize } from "@/lib/portfolio";
import { sips } from "@/lib/sips";
import { cn } from "@/lib/utils";
import Allocation from "./Allocation";
import SchemeDetail from "./SchemeDetail";
import SipTracker from "./SipTracker";
import Goals from "./Goals";
import LookThrough from "./LookThrough";
import PlanMix from "./PlanMix";
import Performance from "./Performance";
import Rebalance from "./Rebalance";
import Dividends from "./Dividends";
import InfoTip from "./InfoTip";
import type { MetricId } from "@/lib/metricInfo";
import { stocksOverview } from "@/lib/stocks";

export type FundSection = "holdings" | "performance" | "insights" | "plan";

export default function MutualFunds({ store, data, setData, section }: ViewProps & { section: FundSection }) {
  const summary = useMemo(() => summarize(data.statements), [data.statements]);
  const cg = useMemo(() => capitalGains(data.statements), [data.statements]);
  const pnl = useMemo(() => computePnL(data.statements, cg), [data.statements, cg]);
  const stocksValue = useMemo(() => stocksOverview(data.stockStatements, new Date().toISOString().slice(0, 10))?.value ?? 0, [data.stockStatements]);
  const sipPlans = useMemo(() => sips(data.statements).plans, [data.statements]);
  const [selected, setSelected] = useState<string | null>(null);
  const detail = summary.schemes.find((x) => x.name === selected) ?? null;
  const partial = summary.schemes.filter((x) => !x.fullHistory);

  return (
    <div className="space-y-4">
      {summary.schemes.length ? (
        <>
          {section === "holdings" && (
            <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Current value" value={money(summary.value)} />
            <Stat label="Invested" value={money(summary.cost)} />
            <Stat
              label="Gain"
              value={money(summary.value - summary.cost)}
              sub={summary.cost ? pct((summary.value - summary.cost) / summary.cost) : undefined}
              tone={summary.value >= summary.cost ? "positive" : "negative"}
            />
            <Stat
              info="xirr"
              label="XIRR"
              value={summary.xirr == null ? "—" : pct(summary.xirr).replace("+", "")}
              sub={
                summary.xirr == null
                  ? "Needs full transaction history"
                  : summary.xirrCoverage < 0.999
                    ? `Covers ${Math.round(summary.xirrCoverage * 100)}% of current value`
                    : "Annualised, all holdings"
              }
              tone={summary.xirr == null ? undefined : summary.xirr >= 0 ? "positive" : "negative"}
            />
          </div>

          {partial.length > 0 && (
            <div className="flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm">
              <InfoIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <p>
                <b>
                  {partial.length} of {summary.schemes.length} schemes
                </b>{" "}
                were bought before this statement starts{summary.historyFrom ? ` (${day(summary.historyFrom)})` : ""}, so their XIRR
                can't be worked out honestly. Upload a statement that goes back to your first investment: on MF Central pick the
                earliest <i>From</i> date, or request a CAMS CAS <i>since inception</i>.
              </p>
            </div>
          )}

          <Allocation schemes={summary.schemes} />

          <Card className="py-0">
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Scheme</TableHead>
                    <TableHead className="text-right">Units</TableHead>
                    <TableHead className="text-right">NAV</TableHead>
                    <TableHead className="text-right">Invested</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead className="pr-6 text-right">XIRR</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.schemes.map((r) => (
                    <TableRow key={r.name} className="cursor-pointer" onClick={() => setSelected(r.name)}>
                      <TableCell className="pl-4 whitespace-normal">
                        <div className="font-medium">{r.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {[r.equityStyle ?? r.assetClass, amcLabel(r.amc), r.folios.length > 1 ? `${r.folios.length} folios` : `Folio ${r.folios[0]}`].join(" · ")}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.units.toFixed(3)}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.nav?.toFixed(2) ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.cost ? money(r.cost) : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(r.value)}
                        {r.cost > 0 && (
                          <div className={cn("text-xs", r.value >= r.cost ? "text-positive" : "text-destructive")}>{pct((r.value - r.cost) / r.cost)}</div>
                        )}
                      </TableCell>
                      <TableCell
                        className={cn("pr-6 text-right tabular-nums", r.xirr != null && (r.xirr >= 0 ? "text-positive" : "text-destructive"))}
                        title={r.fullHistory ? undefined : "Bought before this statement starts; upload a statement with full history"}
                      >
                        {r.xirr == null ? <span className="text-muted-foreground">—</span> : pct(r.xirr).replace("+", "")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

            </>
          )}

          {section === "insights" && (
            <div className="space-y-4">
              <LookThrough store={store} schemes={summary.schemes} />
              <SipTracker statements={data.statements} onOpen={(name) => setSelected(summary.schemes.find((x) => schemeKey(x.name) === schemeKey(name))?.name ?? null)} />

              <PlanMix schemes={summary.schemes} />
            </div>
          )}

          {section === "performance" && (
            <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Stat
              label="Realised gain"
              value={money(pnl.realised)}
              sub={cg.unmatched.length ? "Excludes sales of units bought before the statement" : "From redemptions and switches, all time"}
              tone={pnl.realised >= 0 ? "positive" : "negative"}
            />
            <Stat label="Dividends" value={money(pnl.dividends)} sub="Paid out or reinvested" />
          </div>
              <Dividends statements={data.statements} />
              <Performance store={store} data={data} setData={setData} />
            </div>
          )}

          {section === "plan" && (
            <div className="space-y-4">
              <Rebalance store={store} data={data} setData={setData} schemes={summary.schemes} stocksValue={stocksValue} />
              <Goals store={store} data={data} setData={setData} schemes={summary.schemes} />
            </div>
          )}
        </>
      ) : (
        <Card className="py-16 text-center text-sm text-muted-foreground">
          <p>
            No mutual fund data yet. Request a <b>detailed</b> CAS from{" "}
            <a
              className="font-medium text-primary underline underline-offset-4"
              href="https://www.camsonline.com/Investors/Statements/Consolidated-Account-Statement"
              target="_blank"
              rel="noreferrer"
            >
              CAMS
            </a>{" "}
            to one of your connected inboxes and Sync, or use Import (top right) to add the PDF. The detailed report XLSX from{" "}
            <a className="font-medium text-primary underline underline-offset-4" href="https://app.mfcentral.com" target="_blank" rel="noreferrer">
              MF Central
            </a>{" "}
            works too.
          </p>
        </Card>
      )}

      <SchemeDetail
        scheme={detail}
        cg={cg}
        pnl={pnl}
        plan={detail ? sipPlans.find((p) => schemeKey(p.scheme) === schemeKey(detail.name)) : undefined}
        onClose={() => setSelected(null)}
      />

    </div>
  );
}

function Stat({ label, value, sub, tone, info }: { label: string; value: string; sub?: string; tone?: "positive" | "negative"; info?: MetricId }) {
  return (
    <Card className="gap-1 px-4">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">{label}{info && <InfoTip id={info} />}</div>
      <div className={cn("text-2xl font-semibold tabular-nums tracking-tight", tone === "positive" && "text-positive", tone === "negative" && "text-destructive")}>
        {value}
      </div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </Card>
  );
}
