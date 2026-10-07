import { useId, useState } from "react";
import { day } from "@/lib/format";

/** A shaded range between two values per date, drawn behind the lines. */
export interface ChartBand {
  key: string;
  label: string;
  color: string;
  points: { date: string; lo: number; hi: number }[];
}

export interface ChartSeries {
  key: string;
  label: string;
  /** Any CSS colour, e.g. `var(--chart-1)`. */
  color: string;
  dashed?: boolean;
  points: { date: string; v: number }[];
}

const W = 720;
const H = 230;
const M = { l: 56, r: 12, t: 12, b: 22 };

/** ₹1.2L, ₹3.4Cr. */
export function compactINR(n: number) {
  const a = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(a >= 1e8 ? 0 : 1)}Cr`;
  if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(a >= 1e6 ? 0 : 1)}L`;
  if (a >= 1e3) return `${sign}₹${(a / 1e3).toFixed(0)}k`;
  return `${sign}₹${Math.round(a)}`;
}

/** Lines over a shared date axis, with a crosshair that reads out every series at the hovered date. */
export default function LineChart({ series, label, bands = [] }: { series: ChartSeries[]; label: string; bands?: ChartBand[] }) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const dates = [...new Set([...series.flatMap((s) => s.points.map((p) => p.date)), ...bands.flatMap((b) => b.points.map((p) => p.date))])].sort();
  if (dates.length < 2) return null;

  const t = (d: string) => Date.parse(`${d}T00:00:00Z`);
  const t0 = t(dates[0]);
  const t1 = t(dates.at(-1)!);
  const vals = [...series.flatMap((s) => s.points.map((p) => p.v)), ...bands.flatMap((b) => b.points.flatMap((p) => [p.lo, p.hi]))];
  const lo = Math.min(0, ...vals);
  const hi = Math.max(...vals, 1);
  const x = (d: string) => M.l + ((t(d) - t0) / Math.max(1, t1 - t0)) * (W - M.l - M.r);
  const y = (v: number) => H - M.b - ((v - lo) / (hi - lo)) * (H - M.t - M.b);
  const ticks = [0, 1, 2, 3].map((i) => lo + ((hi - lo) * i) / 3);
  const at = hover != null ? dates[hover] : null;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const target = t0 + ((px - M.l) / (W - M.l - M.r)) * (t1 - t0);
    let best = 0;
    dates.forEach((d, i) => Math.abs(t(d) - target) < Math.abs(t(dates[best]) - target) && (best = i));
    setHover(best);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 rounded" style={{ background: s.color, opacity: s.dashed ? 0.6 : 1 }} />
            {s.label}
          </span>
        ))}
        {bands.map((b) => (
          <span key={b.key} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-4 rounded-sm" style={{ background: b.color, opacity: 0.3 }} />
            {b.label}
          </span>
        ))}
        {at && (
          <span className="ml-auto tabular-nums text-foreground">
            {day(at)}
            {bands.map((b) => {
              const p = b.points.find((q) => q.date === at);
              return p ? (
                <span key={b.key} className="ml-3 text-muted-foreground">
                  {compactINR(p.lo)}–{compactINR(p.hi)}
                </span>
              ) : null;
            })}
            {series.map((s) => {
              const p = s.points.find((q) => q.date === at);
              return p ? (
                <span key={s.key} className="ml-3">
                  <span style={{ color: s.color }}>●</span> {compactINR(p.v)}
                </span>
              ) : null;
            })}
          </span>
        )}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none"
        role="img"
        aria-label={label}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <title id={id}>{label}</title>
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`${id}-${s.key}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity="0.22" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} className="stroke-border/60" strokeDasharray={v === lo ? undefined : "2 5"} />
            <text x={M.l - 8} y={y(v) + 4} textAnchor="end" className="fill-muted-foreground text-[11px]">
              {compactINR(v)}
            </text>
          </g>
        ))}
        <text x={M.l} y={H - 4} className="fill-muted-foreground text-[11px]">{day(dates[0])}</text>
        <text x={W - M.r} y={H - 4} textAnchor="end" className="fill-muted-foreground text-[11px]">{day(dates.at(-1)!)}</text>
        {bands.map((b) => (
          <path
            key={`${b.key}-band`}
            d={`${b.points.map((p, i) => `${i ? "L" : "M"}${x(p.date).toFixed(1)},${y(p.hi).toFixed(1)}`).join("")}${[...b.points].reverse().map((p) => `L${x(p.date).toFixed(1)},${y(p.lo).toFixed(1)}`).join("")}Z`}
            fill={b.color}
            fillOpacity="0.16"
          />
        ))}
        {series.map((s) =>
          s.dashed ? null : (
            <path
              key={`${s.key}-area`}
              d={`${s.points.map((p, i) => `${i ? "L" : "M"}${x(p.date).toFixed(1)},${y(p.v).toFixed(1)}`).join("")}L${x(s.points.at(-1)!.date).toFixed(1)},${y(lo).toFixed(1)}L${x(s.points[0].date).toFixed(1)},${y(lo).toFixed(1)}Z`}
              fill={`url(#${id}-${s.key})`}
            />
          ),
        )}
        {series.map((s) => (
          <path
            key={s.key}
            d={s.points.map((p, i) => `${i ? "L" : "M"}${x(p.date).toFixed(1)},${y(p.v).toFixed(1)}`).join("")}
            fill="none"
            stroke={s.color}
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={s.dashed ? "5 4" : undefined}
          />
        ))}
        {at && (
          <>
            <line x1={x(at)} x2={x(at)} y1={M.t} y2={H - M.b} className="stroke-muted-foreground/50" />
            {series.map((s) => {
              const p = s.points.find((q) => q.date === at);
              return p ? <circle key={s.key} cx={x(at)} cy={y(p.v)} r="4" fill={s.color} className="stroke-card" strokeWidth="2" /> : null;
            })}
          </>
        )}
      </svg>
    </div>
  );
}
