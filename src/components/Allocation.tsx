import { useMemo, useState } from "react";
import { amcLabel, money } from "@/lib/format";
import { ASSET_CLASSES, breakdown, type AssetClass, type SchemeSummary, type Slice } from "@/lib/portfolio";
import SectionCard from "./SectionCard";

// Colour follows the entity, never its rank: Equity is always slot 1, whatever its share.
const CLASS_COLOR: Record<AssetClass, string> = {
  Equity: "var(--chart-1)",
  Debt: "var(--chart-2)",
  Hybrid: "var(--chart-3)",
  "Gold & Silver": "var(--chart-4)",
  Other: "var(--chart-other)",
};

const share = (n: number) => `${(n * 100).toFixed(n < 0.1 ? 1 : 0)}%`;

const MAX_AMCS = 8;

export default function Allocation({ schemes }: { schemes: SchemeSummary[] }) {
  const classes = useMemo(() => {
    const slices = breakdown(schemes, (s) => s.assetClass);
    return ASSET_CLASSES.flatMap((c) => slices.filter((s) => s.key === c)); // fixed legend order
  }, [schemes]);
  const styles = useMemo(() => breakdown(schemes, (s) => s.equityStyle), [schemes]);
  const amcs = useMemo(() => {
    const all = breakdown(schemes, (s) => amcLabel(s.amc));
    if (all.length <= MAX_AMCS + 1) return all;
    const rest = all.slice(MAX_AMCS);
    return [
      ...all.slice(0, MAX_AMCS),
      { key: `${rest.length} others`, value: rest.reduce((a, s) => a + s.value, 0), share: rest.reduce((a, s) => a + s.share, 0), rest: true },
    ];
  }, [schemes]);

  return (
    <SectionCard title="Allocation" bodyClassName="space-y-8">
      <section>
        <h4 className="mb-3 text-sm font-medium text-muted-foreground">Asset class</h4>
        <StackedBar slices={classes} />
      </section>
      <div className="grid gap-8 md:grid-cols-2">
        {styles.length > 0 && (
          <section>
            <h4 className="mb-3 text-sm font-medium text-muted-foreground">Equity by style</h4>
            <BarList slices={styles} />
          </section>
        )}
        <section>
          <h4 className="mb-3 text-sm font-medium text-muted-foreground">By fund house</h4>
          <BarList slices={amcs} />
        </section>
      </div>
    </SectionCard>
  );
}

function StackedBar({ slices }: { slices: Slice<AssetClass>[] }) {
  const [hover, setHover] = useState<AssetClass | null>(null);
  return (
    <div>
      {/* 2px surface gap between segments; rounded outer ends. */}
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={slices.map((s) => `${s.key} ${share(s.share)}`).join(", ")}>
        {slices.map((s) => (
          <div
            key={s.key}
            className="h-full transition-opacity first:rounded-l-full last:rounded-r-full"
            style={{ width: `${s.share * 100}%`, background: CLASS_COLOR[s.key], opacity: hover && hover !== s.key ? 0.35 : 1 }}
            onMouseEnter={() => setHover(s.key)}
            onMouseLeave={() => setHover(null)}
            title={`${s.key}: ${money(s.value)} (${share(s.share)})`}
          />
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
        {slices.map((s) => (
          <li
            key={s.key}
            className="flex items-center gap-2 transition-opacity"
            style={{ opacity: hover && hover !== s.key ? 0.5 : 1 }}
            onMouseEnter={() => setHover(s.key)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="size-2.5 rounded-sm" style={{ background: CLASS_COLOR[s.key] }} />
            <span>{s.key}</span>
            <span className="tabular-nums text-muted-foreground">
              {share(s.share)} · {money(s.value)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Ranked magnitudes in one hue, each labelled with share and value. A folded "others" row is drawn in grey. */
function BarList({ slices }: { slices: (Slice & { rest?: boolean })[] }) {
  const max = Math.max(...slices.map((s) => s.share)) || 1;
  return (
    <ul className="space-y-2.5">
      {slices.map((s) => (
        <li key={s.key} className="group" title={`${s.key}: ${money(s.value)} (${share(s.share)})`}>
          <div className="mb-1 flex justify-between gap-3 text-sm">
            <span className="truncate">{s.key}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              <span className="text-foreground">{share(s.share)}</span> · {money(s.value)}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-muted">
            <div
              className={`h-1.5 rounded-full transition-opacity group-hover:opacity-80 ${s.rest ? "bg-chart-other" : "bg-chart-1"}`}
              style={{ width: `${(s.share / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
