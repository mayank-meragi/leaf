import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon, CopyIcon, InfoIcon, Loader2Icon, RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ViewProps } from "@/App";
import { day, money } from "@/lib/format";
import { fetchViaHelper, helperUp, HELPER_COMMAND, planSync, serializeHoldings, settle, type SyncTarget } from "@/lib/helper";
import { costs, holdingsPath, loadHoldings, lookThrough, monthsOld, overlapMatrix, overlaps, type FundHoldings, type FundInput, type OverlapMatrix, type PairOverlap } from "@/lib/holdings";
import { CODES_PATH, type CodeMap } from "@/lib/nav";
import { schemeKey, type SchemeSummary } from "@/lib/portfolio";
import { cn } from "@/lib/utils";
import InfoTip from "./InfoTip";
import SectionCard from "./SectionCard";
import type { MetricId } from "@/lib/metricInfo";

const STALE_MONTHS = 2;

interface Loaded {
  funds: FundInput[];
  /** Every saved holdings file for these schemes, keyed by AMFI code. */
  saved: Map<number, FundHoldings>;
  /** One per scheme that has an AMFI code: what the helper should fetch. */
  targets: SyncTarget[];
}
type State = { status: "loading" } | { status: "no-codes" } | { status: "error"; message: string } | ({ status: "ready" } & Loaded);

export default function LookThrough({ store, schemes }: Pick<ViewProps, "store"> & { schemes: SchemeSummary[] }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let live = true;
    (async () => {
      const codes = await store.readJSON<CodeMap>(CODES_PATH);
      if (!codes || !Object.keys(codes).length) return live && setState({ status: "no-codes" });
      const byScheme = new Map(schemes.map((s) => [s.name, codes[schemeKey(s.name)]?.code] as const));
      const targets = schemes.flatMap((s) => (byScheme.get(s.name) != null ? [{ code: byScheme.get(s.name)!, name: codes[schemeKey(s.name)].name || s.name }] : []));
      const saved = await loadHoldings(store, targets.map((t) => t.code));
      const funds = schemes.flatMap((s) => {
        const code = byScheme.get(s.name);
        const fund = code == null ? undefined : saved.get(code);
        return fund ? [{ name: s.name, value: s.value, fund }] : [];
      });
      if (live) setState({ status: "ready", funds, saved, targets });
    })().catch((e) => live && setState({ status: "error", message: (e as Error).message }));
    return () => {
      live = false;
    };
  }, [store, schemes, version]);

  if (state.status === "loading")
    return (
      <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2Icon className="size-4 animate-spin" /> Reading holdings…
      </p>
    );
  if (state.status === "error") return <Empty>Couldn't read holdings: {state.message}</Empty>;
  if (state.status === "no-codes")
    return <Empty>Holdings are fetched for the schemes Leaf has matched to AMFI codes. Open the <b>Performance</b> tab and click <b>Load NAV history</b> first.</Empty>;

  const sync = <SyncBar store={store} targets={state.targets} saved={state.saved} onDone={reload} />;
  if (!state.funds.length)
    return (
      <div className="space-y-4">
        <Card className="px-4 py-8 text-center text-sm text-muted-foreground">
          <p>No fund holdings saved yet. Sync them to see overlap, what you really own and what your funds cost.</p>
        </Card>
        {sync}
      </div>
    );
  return (
    <div className="space-y-4">
      {sync}
      <Ready funds={state.funds} total={schemes.reduce((s, x) => s + x.value, 0)} missing={schemes.length - state.funds.length} />
    </div>
  );
}

/** Fetches holdings through the local helper and commits whatever changed to the data repo. */
function SyncBar({ store, targets, saved, onDone }: { store: ViewProps["store"]; targets: SyncTarget[]; saved: Map<number, FundHoldings>; onDone: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [down, setDown] = useState(false);
  const [copied, setCopied] = useState(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const run = async (force = false) => {
    setBusy("Looking for the local helper…");
    try {
      if (!(await helperUp())) return setDown(true);
      setDown(false);

      const plan = planSync(targets, saved, new Date().toISOString().slice(0, 10), force);
      if (!plan.fetch.length) {
        toast.info("Holdings were fetched within the last 20 days.", { action: { label: "Refetch anyway", onClick: () => run(true) } });
        return;
      }

      abort.current = new AbortController();
      const results = await fetchViaHelper(plan.fetch, (_r, done) => setBusy(`Fetching holdings ${done}/${plan.fetch.length}…`), abort.current.signal);
      const out = settle(results, saved);

      if (out.changed.length) {
        setBusy("Saving to your data repo…");
        const files = Object.fromEntries(out.changed.map((d) => [holdingsPath(d.code), serializeHoldings(d)]));
        await store.commit(files, `Update fund holdings (${out.changed.length} scheme${out.changed.length === 1 ? "" : "s"})`);
      }
      onDone();

      const reasons = Object.values(out.failed);
      if (reasons.length && reasons.length === plan.fetch.length) {
        // Everything failed: that's the helper or the network, not 24 separate problems.
        toast.error("Couldn't fetch any fund holdings", { description: `${[...new Set(reasons)][0]}\nCheck the terminal where the helper is running.` });
        return;
      }
      const failed = Object.entries(out.failed).map(([code, why]) => `${targets.find((t) => t.code === Number(code))?.name ?? code}: ${why}`);
      const summary = `${out.changed.length} updated, ${out.unchanged.length + plan.fresh.length} already current`;
      if (failed.length) toast.warning(`${summary}, ${failed.length} failed`, { description: failed.join("\n") });
      else toast.success(`Fund holdings synced: ${summary}`);
    } catch (e) {
      if ((e as Error).name !== "AbortError") toast.error("Couldn't sync fund holdings", { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    await navigator.clipboard?.writeText(HELPER_COMMAND).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Fetched by a small helper that runs only on this computer, then saved to your data repo.</p>
        <Button variant="outline" onClick={() => run()} disabled={!!busy || !targets.length}>
          {busy ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
          {busy ?? "Sync fund holdings"}
        </Button>
      </div>
      {down && (
        <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm">
          <p>
            <b>The local helper isn't running.</b> Start it in a terminal in the Leaf folder, leave it running, then click Sync again:
          </p>
          <div className="flex items-center gap-2">
            <code className="rounded bg-muted px-2 py-1 font-mono text-xs">{HELPER_COMMAND}</code>
            <Button variant="ghost" size="sm" onClick={copy}>
              {copied ? <CheckIcon /> : <CopyIcon />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">It needs Python 3.11+ and nothing else. It listens on this machine only and works only with this page.</p>
        </div>
      )}
    </div>
  );
}

function Ready({ funds, total, missing }: { funds: FundInput[]; total: number; missing: number }) {
  const look = useMemo(() => lookThrough(funds, total), [funds, total]);
  const cost = useMemo(() => costs(funds, total), [funds, total]);
  const pairs = useMemo(() => overlaps(funds), [funds]);
  const matrix = useMemo(() => overlapMatrix(funds), [funds]);
  const dates = funds.map((f) => f.fund.portfolioDate).filter((d): d is string => !!d).sort();
  const oldest = dates[0];
  const stale = oldest != null && monthsOld(oldest) > STALE_MONTHS;
  const stand = funds.filter((f) => f.fund.holdingsFrom);

  return (
    <div className="space-y-4">
      {(stale || missing > 0 || stand.length > 0) && (
        <div className="flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm">
          <InfoIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="space-y-1">
            {stale && <p>Some portfolios are from {day(oldest!)}, more than {STALE_MONTHS} months old. Click <b>Sync fund holdings</b> to refresh them.</p>}
            {missing > 0 && <p>{missing} scheme{missing === 1 ? " has" : "s have"} no holdings saved, so {missing === 1 ? "it isn't" : "they aren't"} counted below.</p>}
            {stand.length > 0 && <p>{stand.length} Regular plan{stand.length === 1 ? "" : "s"} use their Direct twin's holdings, which are the same portfolio.</p>}
          </div>
        </div>
      )}

      <SectionCard title="What you really own" description="Each fund's stocks, scaled by how much you hold in it and added up across funds." bodyClassName="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile info="concentration" label="Top 10 stocks" value={`${(look.top10Share * 100).toFixed(1)}%`} sub="of your whole portfolio" />
          <Tile
            info="effectiveStocks"
            label="Effective stocks"
            value={look.effectiveStocks == null ? "—" : look.effectiveStocks.toFixed(0)}
            sub={`of ${look.stocks.length} unique · ${look.positions} positions`}
          />
          <Tile label="In listed stocks" value={money(look.equityAmount)} sub={`${look.stocks.length} different stocks`} />
          <Tile label="Funds covered" value={`${(look.coverage * 100).toFixed(0)}%`} sub="of portfolio value" />
        </div>

        <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Stock</TableHead>
                <TableHead className="text-right">Exposure</TableHead>
                <TableHead className="text-right">Of portfolio</TableHead>
                <TableHead className="text-right">Funds</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {look.stocks.slice(0, 15).map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="whitespace-normal">
                    <div>{s.name}</div>
                    {s.sector && <div className="text-xs text-muted-foreground">{s.sector}</div>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{money(s.amount)}</TableCell>
                  <TableCell className="text-right tabular-nums">{(s.share * 100).toFixed(2)}%</TableCell>
                  <TableCell className="text-right tabular-nums" title={s.funds.map((f) => `${f.name}: ${money(f.amount)}`).join("\n")}>
                    {s.funds.length}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="space-y-2">
            <h3 className="text-sm font-medium">Sectors</h3>
            {look.sectors.slice(0, 10).map((s) => (
              <div key={s.sector} className="space-y-0.5">
                <div className="flex justify-between text-sm">
                  <span>{s.sector}</span>
                  <span className="tabular-nums text-muted-foreground">{(s.share * 100).toFixed(1)}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full" style={{ width: `${Math.min(100, (s.amount / (look.sectors[0].amount || 1)) * 100)}%`, background: "var(--chart-1)" }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </SectionCard>

      <Overlap pairs={pairs} matrix={matrix} />

      <SectionCard title="Fund costs" description="Expense ratios are deducted from the NAV every day, so you never see a bill." bodyClassName="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Tile info="expenseRatio" label="Weighted expense ratio" value={cost.weighted == null ? "—" : `${cost.weighted.toFixed(2)}%`} sub="a year, by value" />
          <Tile label="Cost a year" value={money(cost.annual)} sub="on funds with a known ratio" />
          <Tile label="Covered" value={`${(cost.coverage * 100).toFixed(0)}%`} sub="of portfolio value" />
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Scheme</TableHead>
              <TableHead className="text-right">Value</TableHead>
              <TableHead className="text-right">Expense ratio</TableHead>
              <TableHead className="text-right">A year</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cost.rows.map((r) => (
              <TableRow key={r.name}>
                <TableCell className="whitespace-normal">{r.name}</TableCell>
                <TableCell className="text-right tabular-nums">{money(r.value)}</TableCell>
                <TableCell className="text-right tabular-nums">{r.ratio == null ? <span className="text-muted-foreground" title="Regular plans' own ratios aren't published by the source">n/a</span> : `${r.ratio.toFixed(2)}%`}</TableCell>
                <TableCell className="text-right tabular-nums">{r.annual == null ? "—" : money(r.annual)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SectionCard>

      <p className="text-xs text-muted-foreground">
        Holdings are each fund's monthly disclosure{oldest ? `, latest as of ${day(dates.at(-1)!)}` : ""}, fetched by the local helper. They can lag what a fund holds today.
      </p>
    </div>
  );
}

function Overlap({ pairs, matrix }: { pairs: PairOverlap[]; matrix: OverlapMatrix }) {
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const shown = all ? pairs : pairs.slice(0, 8);
  const level = (o: number) => (o >= 50 ? "text-destructive" : o >= 35 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground");

  return (
    <SectionCard title="Fund overlap" info={<InfoTip id="overlap" />} description="How much of one fund is the same stocks as another. High overlap means you're paying two fees for one portfolio." bodyClassName="space-y-3">
      {matrix.weighted != null && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Tile info="portfolioOverlap" label="Portfolio overlap" value={`${matrix.weighted.toFixed(0)}%`} sub="average across fund pairs, by amount held" />
          <Tile
            label="Most overlapping pair"
            value={matrix.top ? `${matrix.top.overlap.toFixed(0)}%` : "—"}
            sub={matrix.top ? `${matrix.top.a} · ${matrix.top.b}` : "No two funds share a stock"}
          />
        </div>
      )}
      {matrix.names.length >= 2 && matrix.names.length <= 12 && <Matrix matrix={matrix} />}
      {pairs.length === 0 && <p className="text-sm text-muted-foreground">No two of your equity funds share a stock, or you hold only one.</p>}
      {shown.map((p) => {
        const key = `${p.a}|${p.b}`;
        return (
          <div key={key} className="rounded-lg border">
            <button className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm" onClick={() => setOpen(open === key ? null : key)} aria-expanded={open === key}>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{p.a}</span>
                <span className="block truncate text-muted-foreground">{p.b}</span>
              </span>
              <span className="w-28 shrink-0">
                <span className={cn("block text-right font-medium tabular-nums", level(p.overlap))}>{p.overlap.toFixed(0)}%</span>
                <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-muted">
                  <span className="block h-full rounded-full" style={{ width: `${Math.min(100, p.overlap)}%`, background: p.overlap >= 50 ? "var(--destructive)" : "var(--chart-1)" }} />
                </span>
              </span>
            </button>
            {open === key && (
              <div className="border-t px-4 py-2">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{p.shared.length} shared stocks</TableHead>
                      <TableHead className="text-right">In first</TableHead>
                      <TableHead className="text-right">In second</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {p.shared.slice(0, 10).map((s) => (
                      <TableRow key={s.id}>
                        <TableCell>{s.name}</TableCell>
                        <TableCell className="text-right tabular-nums">{s.a.toFixed(2)}%</TableCell>
                        <TableCell className="text-right tabular-nums">{s.b.toFixed(2)}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        );
      })}
      {pairs.length > 8 && (
        <button className="text-sm text-muted-foreground underline underline-offset-4" onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `Show all ${pairs.length} pairs`}
        </button>
      )}
    </SectionCard>
  );
}

function Matrix({ matrix }: { matrix: OverlapMatrix }) {
  const short = (n: string) => (n.length > 22 ? `${n.slice(0, 21)}…` : n);
  const shade = (o: number) => (o >= 50 ? "bg-destructive/15 font-semibold text-destructive" : o >= 35 ? "bg-amber-500/15 font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground");
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr>
            <th />
            {matrix.names.map((n, j) => (
              <th key={n} className="max-w-24 px-2 py-1 text-right font-normal text-muted-foreground" title={n}>
                {j + 1}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.names.map((n, i) => (
            <tr key={n} className="border-t">
              <th className="whitespace-nowrap py-1.5 pr-3 text-left font-normal" title={n}>
                <span className="mr-1.5 text-muted-foreground">{i + 1}</span>
                {short(n)}
              </th>
              {matrix.cells[i].map((o, j) => (
                <td key={j} className={cn("px-2 py-1.5 text-right tabular-nums", i === j ? "text-muted-foreground/40" : shade(o))}>
                  {i === j ? "—" : `${o.toFixed(0)}%`}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Tile({ label, value, sub, info }: { label: string; value: string; sub?: string; info?: MetricId }) {
  return (
    <div className="rounded-lg border px-4 py-3">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">{label}{info && <InfoTip id={info} />}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <Card className="px-4 py-10 text-center text-sm text-muted-foreground">
      <p>{children}</p>
    </Card>
  );
}

export type { FundHoldings };
