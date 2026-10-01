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
          <Tile label="Active SIPs" value={String(summary.active.length)} sub={stopped.length ? `${stopped.length} stopped` : undefined} />
          <Tile label="Monthly outflow" value={money(summary.monthlyOutflow)} sub="Across active SIPs" />
          <Tile label="Missed or bounced" value={String(issues)} sub="Instalments in active SIPs" warn={issues > 0} />
        </div>

        {rows.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Scheme</TableHead>
                <TableHead className="text-right">Amount</TableHead>
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
                    {money(p.amount)}
                    {p.stepUps.length > 0 && <div className="text-xs text-muted-foreground">↑ from {money(p.stepUps[0].from)}</div>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {p.cadence}
                    {p.cadence === "Monthly" && <span className="text-muted-foreground"> · day {p.day}</span>}
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
