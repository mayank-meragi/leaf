import { useMemo } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { MFTransaction, MFTxnType } from "@/types";
import type { CapitalGains } from "@/lib/capitalGains";
import { longTermFrom } from "@/lib/capitalGains";
import { amcLabel, day, money, pct } from "@/lib/format";
import { flowOf, schemeKey, type SchemeSummary } from "@/lib/portfolio";
import type { PnL } from "@/lib/pnl";
import type { SipPlan } from "@/lib/sips";
import { cn } from "@/lib/utils";
import { Flags, Schedule } from "./SipTracker";

const TYPE_LABEL: Record<MFTxnType, string> = {
  PURCHASE: "Purchase",
  PURCHASE_SIP: "SIP",
  REDEMPTION: "Redemption",
  SWITCH_IN: "Switch in",
  SWITCH_OUT: "Switch out",
  DIVIDEND_PAYOUT: "Dividend",
  DIVIDEND_REINVEST: "Dividend reinvested",
  STAMP_DUTY: "Stamp duty",
  STT: "STT",
  TDS: "TDS",
  REVERSAL: "Reversal",
  MISC: "Other",
};

const tone = (n: number) => (n > 0 ? "text-positive" : n < 0 ? "text-destructive" : undefined);

interface Props {
  scheme: SchemeSummary | null;
  cg: CapitalGains;
  pnl: PnL;
  plan?: SipPlan;
  onClose: () => void;
}

export default function SchemeDetail({ scheme, cg, pnl, plan, onClose }: Props) {
  return (
    <Dialog open={!!scheme} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] gap-5 overflow-y-auto sm:max-w-3xl">{scheme && <Body scheme={scheme} cg={cg} pnl={pnl} plan={plan} />}</DialogContent>
    </Dialog>
  );
}

function Body({ scheme: s, cg, pnl, plan }: Omit<Props, "onClose"> & { scheme: SchemeSummary }) {
  const key = schemeKey(s.name);
  const p = pnl.byScheme.get(key) ?? { realised: 0, dividends: 0 };
  const unrealised = s.cost ? s.value - s.cost : null;
  const lots = cg.open.filter((l) => schemeKey(l.scheme) === key);
  const txns = useMemo(() => [...s.transactions].sort((a, b) => b.date.localeCompare(a.date)), [s.transactions]);
  const total = (unrealised ?? 0) + p.realised + p.dividends;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="pr-6 leading-snug">{s.name}</DialogTitle>
        <DialogDescription>
          {[s.equityStyle ?? s.assetClass, amcLabel(s.amc), s.folios.length > 1 ? `${s.folios.length} folios` : `Folio ${s.folios[0]}`].join(" · ")}
        </DialogDescription>
      </DialogHeader>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Value" value={money(s.value)} sub={s.nav ? `${s.units.toFixed(3)} units @ ${s.nav.toFixed(2)}` : `${s.units.toFixed(3)} units`} />
        <Tile label="Invested" value={s.cost ? money(s.cost) : "—"} />
        <Tile label="XIRR" value={s.xirr == null ? "—" : pct(s.xirr).replace("+", "")} tone={s.xirr ?? undefined} sub={s.xirr == null ? "Needs full history" : undefined} />
        <Tile label="Total profit" value={money(total)} tone={total} sub="Unrealised + realised + dividends" />
        <Tile label="Unrealised" value={unrealised == null ? "—" : money(unrealised)} tone={unrealised ?? undefined} sub={unrealised != null && s.cost ? pct(unrealised / s.cost) : undefined} />
        <Tile label="Realised" value={money(p.realised)} tone={p.realised} sub="Redemptions and switches" />
        <Tile label="Dividends" value={money(p.dividends)} />
      </div>

      <InvestedChart txns={s.transactions} value={s.value} asOf={s.asOf} complete={s.fullHistory} />

      {plan && (
        <div className="space-y-1 rounded-lg border px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <b>{plan.active && plan.sips > 1 ? `${plan.sips} SIPs` : "SIP"}</b>
            {plan.active ? ` ${money(plan.monthly)} a month` : null}
            {!plan.active && <span className="text-muted-foreground"> stopped</span>}
            <Flags plan={plan} />
          </div>
          <div className="text-xs text-muted-foreground">
            <Schedule plan={plan} /> · {plan.count} instalments since {day(plan.first)}, {money(plan.invested)} in total
            {plan.stepUps.length > 0 && `; stepped up ${plan.stepUps.length}×, latest ${money(plan.stepUps.at(-1)!.from)} → ${money(plan.stepUps.at(-1)!.to)}`}
          </div>
        </div>
      )}

      {lots.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium">Open lots</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bought</TableHead>
                <TableHead className="text-right">Units</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead>Long term from</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lots.map((l, i) => {
                const lt = longTermFrom(l.regime, l.buyDate);
                const done = lt != null && lt <= s.asOf;
                return (
                  <TableRow key={i}>
                    <TableCell className="whitespace-nowrap">{day(l.buyDate)}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.units.toFixed(3)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(l.cost)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {lt == null ? <span className="text-muted-foreground">Always slab rate</span> : done ? <span className="text-positive">Long term</span> : day(lt)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </section>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-medium">Transactions</h3>
        {txns.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Units</TableHead>
                <TableHead className="text-right">NAV</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {txns.map((t, i) => (
                <TableRow key={i}>
                  <TableCell className="whitespace-nowrap">{day(t.date)}</TableCell>
                  <TableCell>{TYPE_LABEL[t.type]}</TableCell>
                  <TableCell className={cn("text-right tabular-nums", tone(flowOf(t)))}>{t.amount == null ? "—" : money(Math.abs(t.amount), "INR", true)}</TableCell>
                  <TableCell className="text-right tabular-nums">{t.units == null ? "—" : t.units.toFixed(3)}</TableCell>
                  <TableCell className="text-right tabular-nums">{t.nav?.toFixed(2) ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">This statement lists no transactions for the scheme.</p>
        )}
      </section>
    </>
  );
}

/** Net cash put in over time (purchases less redemptions), against today's value. */
function InvestedChart({ txns, value, asOf, complete }: { txns: MFTransaction[]; value: number; asOf: string; complete: boolean }) {
  const pts = useMemo(() => {
    let running = 0;
    return [...txns]
      .filter((t) => t.type !== "DIVIDEND_PAYOUT" && t.type !== "DIVIDEND_REINVEST")
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((t) => ({ t: Date.parse(t.date), v: (running -= flowOf(t)) }));
  }, [txns]);
  if (pts.length < 2) return null;

  const W = 640, H = 150, pad = 4;
  const t0 = pts[0].t;
  const t1 = Math.max(Date.parse(asOf) || 0, pts.at(-1)!.t);
  const top = Math.max(value, ...pts.map((p) => p.v), 1);
  const bot = Math.min(0, ...pts.map((p) => p.v));
  const x = (t: number) => pad + ((t - t0) / Math.max(1, t1 - t0)) * (W - 2 * pad);
  const y = (v: number) => H - pad - ((v - bot) / (top - bot)) * (H - 2 * pad);

  // Step line: net invested holds until the next transaction.
  let d = `M${x(t0)},${y(0)}`;
  let prev = 0;
  for (const p of pts) {
    d += `L${x(p.t)},${y(prev)}L${x(p.t)},${y(p.v)}`;
    prev = p.v;
  }
  d += `L${x(t1)},${y(prev)}`;

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-medium">Net invested over time</h3>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-3 bg-primary" />Net invested</span>
          <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-full bg-positive" />Value today</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Net invested over time against current value">
        <line x1={pad} x2={W - pad} y1={y(0)} y2={y(0)} className="stroke-border" />
        <path d={d} fill="none" strokeWidth="2" strokeLinejoin="round" className="stroke-primary" />
        <circle cx={x(t1)} cy={y(value)} r="4" className="fill-positive" />
      </svg>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{day(pts[0] ? new Date(t0).toISOString().slice(0, 10) : asOf)}</span>
        <span>{day(asOf)}</span>
      </div>
      {!complete && <p className="text-xs text-muted-foreground">Units bought before the statement begins aren't in this line, so it understates what you've put in.</p>}
    </section>
  );
}

function Tile({ label, value, sub, tone: t }: { label: string; value: string; sub?: string; tone?: number }) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("text-lg font-semibold tabular-nums tracking-tight", t != null && tone(t))}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}
