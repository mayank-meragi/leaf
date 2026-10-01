import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { money } from "@/lib/format";
import { planMix, TYPICAL_COMMISSION } from "@/lib/planType";
import type { SchemeSummary } from "@/lib/portfolio";

export default function PlanMix({ schemes }: { schemes: SchemeSummary[] }) {
  const m = planMix(schemes);
  const total = m.by.Direct + m.by.Regular + m.by.Unknown || 1;
  const parts = (["Direct", "Regular", "Unknown"] as const).filter((k) => m.by[k] > 0);
  const color = { Direct: "var(--chart-1)", Regular: "var(--chart-4)", Unknown: "var(--chart-other)" };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Direct vs Regular</CardTitle>
        <CardDescription>Regular plans pay your distributor a commission out of the fund's returns, every year.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex h-2.5 overflow-hidden rounded-full bg-muted" role="img" aria-label="Share of value in Direct and Regular plans">
          {parts.map((k) => (
            <div key={k} style={{ width: `${(m.by[k] / total) * 100}%`, background: color[k] }} />
          ))}
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {parts.map((k) => (
            <span key={k} className="flex items-center gap-2">
              <span className="size-2 rounded-full" style={{ background: color[k] }} />
              {k} <b className="tabular-nums">{money(m.by[k])}</b> <span className="text-muted-foreground tabular-nums">{((m.by[k] / total) * 100).toFixed(0)}%</span>
            </span>
          ))}
        </div>

        {m.regular.length ? (
          <>
            <p className="text-sm">
              <b>{m.regular.length}</b> of your schemes {m.regular.length === 1 ? "is" : "are"} Regular plans holding <b>{money(m.by.Regular)}</b>. Regular plans typically cost{" "}
              {TYPICAL_COMMISSION.low * 100}–{TYPICAL_COMMISSION.high * 100}% a year more than Direct, which would be roughly{" "}
              <b>
                {money(m.dragLow)}–{money(m.dragHigh)}
              </b>{" "}
              a year on this balance. That's a rule of thumb, not your funds' actual expense ratios.
            </p>
            <ul className="divide-y rounded-lg border text-sm">
              {m.regular.map((s) => (
                <li key={s.name} className="flex items-baseline justify-between gap-3 px-4 py-2">
                  <span>{s.name}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{money(s.value)}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              Switching to Direct means redeeming and re-buying, which can trigger capital gains tax and exit load. Check both before moving long-held units.
            </p>
          </>
        ) : (
          m.by.Direct > 0 && <p className="text-sm text-muted-foreground">Everything we could classify is already in Direct plans.</p>
        )}
        {m.by.Unknown > 0 && <p className="text-xs text-muted-foreground">{money(m.by.Unknown)} sits in schemes whose statement doesn't say Direct or Regular.</p>}
      </CardContent>
    </Card>
  );
}
