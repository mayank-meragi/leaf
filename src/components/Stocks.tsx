import { useMemo, useState } from "react";
import { AlertTriangleIcon, InfoIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ViewProps } from "@/App";
import { day, money, pct } from "@/lib/format";
import { stockHistory, stocksOverview, type Holding } from "@/lib/stocks";
import { cn } from "@/lib/utils";
import LineChart from "./LineChart";
import SectionCard from "./SectionCard";

type Sort = "value" | "pnl" | "pnlPct" | "name";
const SORTS: { value: Sort; label: string }[] = [
  { value: "value", label: "Value" },
  { value: "pnl", label: "Profit ₹" },
  { value: "pnlPct", label: "Return %" },
  { value: "name", label: "Name" },
];

const tone = (n: number) => (n > 0 ? "text-positive" : n < 0 ? "text-destructive" : undefined);
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${money(Math.abs(n))}`;
const price = (n: number) => money(n, "INR", true);

/** Stocks: what you hold, what it cost, and how it's doing, from your broker's holdings statement. */
export default function Stocks({ data }: ViewProps) {
  const today = new Date().toISOString().slice(0, 10);
  const o = useMemo(() => stocksOverview(data.stockStatements, today), [data.stockStatements, today]);
  const [sort, setSort] = useState<Sort>("value");
  const [selected, setSelected] = useState<string | null>(null);

  const rows = useMemo(() => {
    if (!o) return [];
    const by: Record<Sort, (a: Holding, b: Holding) => number> = {
      value: (a, b) => b.value - a.value,
      pnl: (a, b) => b.pnl - a.pnl,
      pnlPct: (a, b) => b.pnlPct - a.pnlPct,
      name: (a, b) => a.name.localeCompare(b.name),
    };
    return [...o.holdings].sort(by[sort]);
  }, [o, sort]);

  if (!o) {
    return (
      <Card className="items-center gap-2 px-6 py-12 text-center">
        <p className="font-medium">No stock holdings yet</p>
        <p className="max-w-md text-sm text-muted-foreground">
          Download the holdings statement from your broker (Groww: Reports → Holdings; Zerodha: Console → Portfolio → Holdings → download), then Import → Stock holdings.
        </p>
      </Card>
    );
  }

  const detail = o.holdings.find((h) => h.id === selected) ?? null;
  const top = o.holdings.slice(0, 5).reduce((s, h) => s + h.weight, 0);
  const byPct = [...o.holdings].sort((a, b) => b.pnlPct - a.pnlPct);
  const winners = byPct.filter((h) => h.pnl > 0).slice(0, 3);
  const losers = byPct.filter((h) => h.pnl < 0).slice(-3).reverse();

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Current value" value={money(o.value)} sub={`As of ${day(o.asOf)}${o.stale ? " · old" : ""}`} />
        <Stat label="Invested" value={money(o.invested)} />
        <Stat label="Unrealised profit" value={signed(o.pnl)} sub={pct(o.pnlPct)} tone={o.pnl} />
        <Stat label="Holdings" value={String(o.holdings.length)} sub={`Top 5 are ${(top * 100).toFixed(0)}% of value`} />
      </div>

      {o.stale && (
        <div className="flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p>These are closing prices from {day(o.asOf)}. Import a fresh holdings statement to bring the values up to date.</p>
        </div>
      )}
      <div className="flex gap-3 rounded-lg border px-4 py-3 text-sm text-muted-foreground">
        <InfoIcon className="mt-0.5 size-4 shrink-0" />
        <p>A holdings statement shows what you hold, not when you bought it, so there's no XIRR or capital-gains split here. Prices move only when you import a newer statement.</p>
      </div>

      {o.history.length > 1 && (
        <SectionCard title="Value over time" description="At each holdings statement you've imported.">
          <LineChart
            label="Stocks value"
            series={[
              { key: "value", label: "Value", color: "var(--chart-1)", points: o.history.map((h) => ({ date: h.date, v: h.value })) },
              { key: "invested", label: "Invested", color: "var(--chart-3)", dashed: true, points: o.history.map((h) => ({ date: h.date, v: h.invested })) },
            ]}
          />
        </SectionCard>
      )}

      {(winners.length > 0 || losers.length > 0) && (
        <div className="grid gap-4 md:grid-cols-2">
          <Movers title="Best performers" items={winners} onOpen={setSelected} />
          <Movers title="Worst performers" items={losers} onOpen={setSelected} />
        </div>
      )}

      {o.changes && (o.changes.added.length > 0 || o.changes.removed.length > 0 || o.changes.changed.length > 0) && (
        <SectionCard title="Since the last statement" subtitle={day(o.changes.since)}>
          <ul className="space-y-1 text-sm">
            {o.changes.added.map((h) => (
              <li key={h.id}>
                <Badge variant="outline" className="mr-2 font-normal">New</Badge>
                {h.name} · {h.qty} shares
              </li>
            ))}
            {o.changes.changed.map((c) => (
              <li key={c.holding.id}>
                <Badge variant="outline" className="mr-2 font-normal">{c.to > c.from ? "Added" : "Reduced"}</Badge>
                {c.holding.name} · {c.from} → {c.to} shares
              </li>
            ))}
            {o.changes.removed.map((h) => (
              <li key={h.isin ?? h.name}>
                <Badge variant="outline" className="mr-2 font-normal">Sold</Badge>
                {h.name}
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="mr-1 text-muted-foreground">Sort by</span>
        {SORTS.map((s) => (
          <button
            key={s.value}
            type="button"
            onClick={() => setSort(s.value)}
            className={cn("rounded-md px-2.5 py-1 text-xs", sort === s.value ? "bg-secondary font-semibold" : "text-muted-foreground hover:bg-accent")}
          >
            {s.label}
          </button>
        ))}
      </div>

      <Card className="py-0">
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Stock</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Avg price</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead className="pr-4 text-right">Profit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((h) => (
                <TableRow key={h.id} className="cursor-pointer" onClick={() => setSelected(h.id)}>
                  <TableCell className="pl-4 whitespace-normal">
                    <div className="font-medium">{h.name}</div>
                    <div className="text-xs text-muted-foreground">{(h.weight * 100).toFixed(1)}% of portfolio</div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{h.qty}</TableCell>
                  <TableCell className="text-right tabular-nums">{price(h.avgPrice)}</TableCell>
                  <TableCell className="text-right tabular-nums">{price(h.price)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(h.value)}</TableCell>
                  <TableCell className={cn("pr-4 text-right tabular-nums", tone(h.pnl))}>
                    {signed(h.pnl)}
                    <div className="text-xs">{pct(h.pnlPct)}</div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!detail} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-h-[90vh] gap-5 overflow-y-auto sm:max-w-2xl">{detail && <Detail h={detail} data={data} />}</DialogContent>
      </Dialog>
    </div>
  );
}

function Movers({ title, items, onOpen }: { title: string; items: Holding[]; onOpen: (id: string) => void }) {
  return (
    <SectionCard title={title}>
      <ul className="divide-y text-sm">
        {items.map((h) => (
          <li key={h.id}>
            <button type="button" onClick={() => onOpen(h.id)} className="flex w-full items-center justify-between gap-3 py-2 text-left hover:text-foreground/80">
              <span className="min-w-0 truncate">{h.name}</span>
              <span className={cn("shrink-0 tabular-nums", tone(h.pnl))}>
                {pct(h.pnlPct)} · {signed(h.pnl)}
              </span>
            </button>
          </li>
        ))}
        {!items.length && <li className="py-2 text-muted-foreground">None</li>}
      </ul>
    </SectionCard>
  );
}

function Detail({ h, data }: { h: Holding; data: ViewProps["data"] }) {
  const history = stockHistory(data.stockStatements, h.id);
  return (
    <>
      <DialogHeader>
        <DialogTitle className="pr-6 leading-snug">{h.name}</DialogTitle>
        <DialogDescription>{[h.isin, `${(h.weight * 100).toFixed(1)}% of your stocks`].filter(Boolean).join(" · ")}</DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Value" value={money(h.value)} sub={`${h.qty} shares @ ${price(h.price)}`} />
        <Tile label="Invested" value={money(h.invested)} sub={`Avg ${price(h.avgPrice)}`} />
        <Tile label="Profit" value={signed(h.pnl)} sub={pct(h.pnlPct)} tone={h.pnl} />
        <Tile label="Break-even" value={price(h.avgPrice)} sub={h.price >= h.avgPrice ? `${pct(h.price / h.avgPrice - 1)} above it` : `${pct(1 - h.price / h.avgPrice).replace("+", "")} below it`} />
      </div>
      {history.length > 1 && (
        <>
          <LineChart label={`${h.name} value`} series={[{ key: "v", label: "Value", color: "var(--chart-1)", points: history.map((x) => ({ date: x.date, v: x.value })) }]} />
          <section className="space-y-2">
            <h3 className="text-sm font-medium">At each statement</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Avg price</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...history].reverse().map((x) => (
                  <TableRow key={x.date}>
                    <TableCell>{day(x.date)}</TableCell>
                    <TableCell className="text-right tabular-nums">{x.qty}</TableCell>
                    <TableCell className="text-right tabular-nums">{price(x.avgPrice)}</TableCell>
                    <TableCell className="text-right tabular-nums">{price(x.price)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(x.value)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        </>
      )}
    </>
  );
}

function Tile({ label, value, sub, tone: t }: { label: string; value: string; sub?: string; tone?: number }) {
  return (
    <div className="rounded-lg border px-3 py-2.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("font-semibold tabular-nums", t != null && tone(t))}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Stat({ label, value, sub, tone: t }: { label: string; value: string; sub?: string; tone?: number }) {
  return (
    <Card className="gap-1 px-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("text-2xl font-semibold tabular-nums tracking-tight", t != null && tone(t))}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </Card>
  );
}
