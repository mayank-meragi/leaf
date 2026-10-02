import { useMemo } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { dividendSummary } from "@/lib/dividends";
import { day, money } from "@/lib/format";
import type { CASStatement } from "@/types";
import SectionCard from "./SectionCard";

/** Mutual fund dividends by financial year and by scheme, paid out vs reinvested. */
export default function Dividends({ statements }: { statements: CASStatement[] }) {
  const d = useMemo(() => dividendSummary(statements), [statements]);
  if (!d.events.length) return null;
  const max = Math.max(...d.byYear.map((y) => y.total), 1);

  return (
    <SectionCard title="Dividends" description="IDCW payouts and reinvestments from your mutual funds, by financial year.">
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <Tile label="Total received" value={money(d.total)} />
          <Tile label="Paid out" value={money(d.payout)} sub="Credited to your bank" />
          <Tile label="Reinvested" value={money(d.reinvested)} sub="Bought more units" />
        </div>

        <ul className="space-y-2 text-sm">
          {d.byYear.map((y) => (
            <li key={y.fy} className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-3">
              <span className="text-muted-foreground">{y.fy}</span>
              <div className="flex h-2 overflow-hidden rounded-full bg-muted" title={`Paid out ${money(y.payout)} · Reinvested ${money(y.reinvested)}`}>
                <div className="bg-[var(--chart-1)]" style={{ width: `${(y.payout / max) * 100}%` }} />
                <div className="bg-[var(--chart-3)]" style={{ width: `${(y.reinvested / max) * 100}%` }} />
              </div>
              <span className="tabular-nums">{money(y.total)}</span>
            </li>
          ))}
        </ul>
        <div className="flex gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-[var(--chart-1)]" />Paid out</span>
          <span className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-[var(--chart-3)]" />Reinvested</span>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Scheme</TableHead>
              <TableHead className="text-right">Dividends</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Last</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {d.byScheme.map((s) => (
              <TableRow key={s.scheme}>
                <TableCell className="whitespace-normal font-medium">{s.scheme}</TableCell>
                <TableCell className="text-right tabular-nums">{s.count}</TableCell>
                <TableCell className="text-right tabular-nums">{money(s.total)}</TableCell>
                <TableCell className="text-right tabular-nums">{day(s.last)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="text-xs text-muted-foreground">Stock dividends aren't included: a broker holdings statement doesn't list them.</p>
      </div>
    </SectionCard>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border px-3 py-2.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}
