import { useMemo, useState } from "react";
import { InfoIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CASStatement } from "@/types";
import { amcLabel, day, money, monthLabel } from "@/lib/format";
import { sips, type SipPlan } from "@/lib/sips";

export default function SipTracker({ statements, onOpen }: { statements: CASStatement[]; onOpen?: (scheme: string) => void }) {
  const summary = useMemo(() => sips(statements), [statements]);
  const [showStopped, setShowStopped] = useState(false);
  if (!summary.plans.length) return null;

  const stopped = summary.plans.filter((p) => !p.active);
  const rows = showStopped ? summary.plans : summary.active;
  const issues = summary.active.reduce((s, p) => s + p.missed.length + p.bounced.length, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>SIPs</CardTitle>
        <CardDescription>Found from systematic instalments in your statements.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Tile label="Active SIPs" value={String(summary.activeSips)} sub={`instalments a month, across ${summary.active.length} fund${summary.active.length === 1 ? "" : "s"}${stopped.length ? ` · ${stopped.length} fund${stopped.length === 1 ? "" : "s"} stopped` : ""}`} />
          <Tile label="Monthly outflow" value={money(summary.monthlyOutflow)} sub="What running SIPs put in each month" />
          <Tile label="Missed or bounced" value={String(issues)} sub="Instalments in active SIPs" warn={issues > 0} />
        </div>

        {rows.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Scheme</TableHead>
                <TableHead className="text-right">Per month</TableHead>
                <TableHead>Schedule</TableHead>
                <TableHead className="text-right">Instalments</TableHead>
                <TableHead className="text-right">Invested</TableHead>
                <TableHead>Last / next</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.scheme} className={onOpen ? "cursor-pointer" : undefined} onClick={() => onOpen?.(p.scheme)}>
                  <TableCell className="whitespace-normal">
                    <div className="font-medium">{p.scheme}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                      {amcLabel(p.amc)}
                      {!p.active && <Badge variant="secondary">Stopped</Badge>}
                      <Flags plan={p} />
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.active ? money(p.monthly) : "—"}
                    {p.stepUps.length > 0 && <div className="text-xs text-muted-foreground">↑ stepped up {p.stepUps.length}×</div>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <Schedule plan={p} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{p.count}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(p.invested)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {day(p.last)}
                    {p.next && <div className="text-xs text-muted-foreground">next ~{day(p.next)}</div>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {stopped.length > 0 && (
          <button className="text-sm text-muted-foreground underline underline-offset-4" onClick={() => setShowStopped((v) => !v)}>
            {showStopped ? "Hide stopped SIPs" : `Show ${stopped.length} stopped SIP${stopped.length === 1 ? "" : "s"}`}
          </button>
        )}

        <p className="flex gap-2 text-xs text-muted-foreground">
          <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
          <span>
            A SIP is stopped when no instalment has landed for a cycle and a half before {summary.asOf ? day(summary.asOf) : "the latest statement"}.
            Statements only show instalments up to their end date, so a recent instalment may not be counted yet.
          </span>
        </p>
      </CardContent>
    </Card>
  );
}

/** "Monthly · day 15" for a single SIP, "3 SIPs" with the due days underneath when a fund has several. */
export function Schedule({ plan: p }: { plan: SipPlan }) {
  const running = p.streams.filter((s) => s.active);
  const shown = running.length ? running : p.streams;
  const sips = shown.reduce((n, s) => n + s.perMonth, 0);
  if (sips === 1) {
    const s = shown[0];
    return (
      <>
        {s.cadence}
        {s.cadence === "Monthly" && <span className="text-muted-foreground"> · day {s.day}</span>}
      </>
    );
  }
  const dayList = [...new Set(shown.map((s) => s.day))].sort((a, b) => a - b);
  return (
    <span title={shown.map((s) => `${money(s.monthly)} a month on day ${s.day}${s.folio ? `, folio ${s.folio}` : ""}`).join("\n")}>
      {sips} SIPs
      <span className="block text-xs text-muted-foreground">day {dayList.join(", ")}</span>
    </span>
  );
}

export function Flags({ plan: p }: { plan: SipPlan }) {
  return (
    <>
      {p.missed.length > 0 && (
        <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-400" title={p.missed.map(monthLabel).join(", ")}>
          {p.missed.length} missed
        </Badge>
      )}
      {p.bounced.length > 0 && (
        <Badge variant="outline" className="border-destructive/40 text-destructive" title={p.bounced.map((b) => day(b.date)).join(", ")}>
          {p.bounced.length} bounced
        </Badge>
      )}
    </>
  );
}

function Tile({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className="rounded-lg border px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={warn ? "text-xl font-semibold tabular-nums text-amber-600 dark:text-amber-400" : "text-xl font-semibold tabular-nums"}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}
