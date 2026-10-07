import { useDeferredValue, useMemo, useState } from "react";
import { AlertTriangleIcon, PlusIcon, RotateCcwIcon, SaveIcon, Trash2Icon, UploadIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import type { ViewProps } from "@/App";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  BUCKETS,
  BUCKET_LABELS,
  baselineFrom,
  DEFAULT_EQUITY_VOL,
  defaultAssumptions,
  describeLevers,
  EVENT_LABELS,
  goalOdds,
  impacts,
  newEvent,
  NO_LEVERS,
  sameLevers,
  simulate,
  withDefaults,
  type LifeEvent,
  project,
  type Assumptions,
  type Baseline,
  type Levers,
} from "@/lib/forecast";
import { money, monthLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useSaveConfig } from "@/lib/useConfig";
import type { ForecastPlan, ForecastScenario } from "@/types";
import { projectGoal } from "@/lib/goals";
import { summarize } from "@/lib/portfolio";
import { sips } from "@/lib/sips";
import LineChart, { compactINR } from "./LineChart";
import SectionCard from "./SectionCard";

/** What you typed over the figures read from your data. */
interface Overrides {
  income?: number;
  expenses?: number;
  sip?: number;
}

interface Saved {
  age: number;
  retireAge: number;
  incomeGrowth: number;
  inflation: number;
  equityReturn?: number;
  equityVol?: number;
  target?: number;
  overrides: Overrides;
  levers: Levers;
  /** Saved scenarios drawn on the chart. */
  shown: string[];
}

const KEY = "leaf.forecast";
const load = (): Partial<Saved> => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
};

/** Colours for saved scenarios on the chart, in order; the unsaved draft gets its own. */
const SCENARIO_COLORS = ["var(--chart-4)", "var(--chart-3)", "var(--chart-other)"];
const DRAFT_COLOR = "var(--chart-2)";

export default function Forecast(props: ViewProps) {
  const { data } = props;
  const { busy, saveConfig } = useSaveConfig(props);
  const today = new Date().toISOString().slice(0, 10);
  const read = useMemo(() => baselineFrom(data, today), [data, today]);
  const defaults = useMemo(() => defaultAssumptions(read), [read]);
  // This browser's draft wins; a new device starts from the plan saved in the repo.
  const [saved] = useState<Partial<Saved>>(() => {
    const local = load();
    return local.age != null ? local : { ...data.config.forecast?.plan };
  });
  const scenarios = data.config.forecast?.scenarios ?? [];
  const [shownRaw, setShown] = useState<string[]>(saved.shown ?? []);
  const shown = shownRaw.filter((id) => scenarios.some((s) => s.id === id));
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [name, setName] = useState("");

  const [age, setAge] = useState(saved.age ?? defaults.age);
  const [retireAge, setRetireAge] = useState(saved.retireAge ?? defaults.retireAge);
  const [incomeGrowth, setIncomeGrowth] = useState(saved.incomeGrowth ?? defaults.incomeGrowth);
  const [inflation, setInflation] = useState(saved.inflation ?? defaults.inflation);
  const [equityReturn, setEquityReturn] = useState(saved.equityReturn ?? defaults.returns.equity);
  const [equityVol, setEquityVol] = useState(saved.equityVol ?? DEFAULT_EQUITY_VOL);
  const [target, setTarget] = useState<number | undefined>(saved.target);
  const [overrides, setOverrides] = useState<Overrides>(saved.overrides ?? {});
  const [levers, setLevers] = useState<Levers>({ ...NO_LEVERS, ...saved.levers });
  const [real, setReal] = useState(true);

  const persist = (patch: Partial<Saved>) => {
    try {
      const now: Saved = { age, retireAge, incomeGrowth, inflation, equityReturn, equityVol, target, overrides, levers, shown, ...patch };
      localStorage.setItem(KEY, JSON.stringify(now));
    } catch {
      /* private mode: the forecast still works, it just isn't remembered */
    }
  };
  /** Sets one piece of state and remembers the whole form. */
  const bind = <K extends keyof Saved>(key: K, set: (v: Saved[K]) => void) => (v: Saved[K]) => {
    set(v);
    persist({ [key]: v } as Partial<Saved>);
  };

  const base: Baseline = { ...read, income: overrides.income ?? read.income, expenses: overrides.expenses ?? read.expenses, sip: overrides.sip ?? read.sip };
  const assumptions: Assumptions = { age, retireAge, incomeGrowth, inflation, returns: { ...defaults.returns, equity: equityReturn } };
  const valid = retireAge > age;
  const scenario = useMemo(() => (valid ? project(base, assumptions, levers, today) : null), [valid, base.income, base.expenses, base.sip, read, age, retireAge, incomeGrowth, inflation, equityReturn, levers, today]);
  const baseline = useMemo(() => (valid ? project(base, assumptions, NO_LEVERS, today) : null), [valid, base.income, base.expenses, base.sip, read, age, retireAge, incomeGrowth, inflation, equityReturn, today]);

  // The spread of outcomes for what's on screen now: your changes if you've made any, otherwise carrying on as now.
  // Deferred so dragging a slider stays smooth; the range catches up a moment later.
  const simInputs = useDeferredValue({ base, assumptions, levers, equityVol });
  const sim = useMemo(
    () => (valid ? simulate(simInputs.base, simInputs.assumptions, simInputs.levers, today, { equityVol: simInputs.equityVol }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [valid, JSON.stringify(simInputs), today],
  );
  const defaultTarget = Math.round((base.expenses * 12) / 0.04 / 100_000) * 100_000;
  const goalTarget = target ?? defaultTarget;
  const goals = data.config.goals ?? [];
  const goalChances = useMemo(() => {
    if (!goals.length) return [];
    const schemes = summarize(data.statements).schemes;
    const plans = sips(data.statements).plans;
    return goals.map((g) => {
      const p = projectGoal(g, schemes, plans, today);
      return { goal: g, p, chance: goalOdds({ current: p.current, monthly: p.monthly, months: p.months, annualReturn: g.returnPct / 100, target: g.target }, equityVol) };
    });
  }, [goals, data.statements, equityVol, today]);
  const impactRows = useMemo(
    () => (valid ? impacts(base, assumptions, levers, today) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [valid, JSON.stringify({ base, assumptions, levers }), today],
  );
  const setEvent = (i: number, patch: Partial<LifeEvent>) => setLever("events", levers.events.map((e, j) => (j === i ? ({ ...e, ...patch } as LifeEvent) : e)));
  const changed = !sameLevers(levers, NO_LEVERS);
  const loaded = scenarios.find((s) => s.id === loadedId);
  const drafted = scenarios.some((s) => sameLevers(s.levers, levers));
  const chosen = scenarios.filter((s) => shown.includes(s.id));
  const chosenForecasts = useMemo(
    () => (valid ? chosen.map((s) => ({ s, f: project(base, assumptions, s.levers, today) })) : []),
    [valid, chosen.map((s) => s.id + JSON.stringify(s.levers)).join("|"), base.income, base.expenses, base.sip, read, age, retireAge, incomeGrowth, inflation, equityReturn, today],
  );
  const plan: ForecastPlan = { age, retireAge, incomeGrowth, inflation, equityReturn, equityVol, target, overrides };
  const toggle = (id: string, on: boolean) => {
    const next = on ? [...shown, id] : shown.filter((x) => x !== id);
    setShown(next);
    persist({ shown: next });
  };
  /** Commits the plan and scenario list to the repo so every device sees them. */
  const saveScenarios = async (next: ForecastScenario[], message: string) => {
    const ok = await saveConfig({ ...data.config, forecast: { plan, scenarios: next } }, message);
    if (!ok) return null;
    return next;
  };
  const saveAsNew = async () => {
    const title = name.trim();
    if (!title) return;
    const sc: ForecastScenario = { id: `sc-${Date.now().toString(36)}`, name: title, levers };
    if (await saveScenarios([...scenarios, sc], `Save forecast scenario ${title}`)) {
      setName("");
      setLoadedId(sc.id);
      toggle(sc.id, true);
      toast.success(`Saved “${title}”`);
    }
  };
  const update = async (s: ForecastScenario) => {
    if (await saveScenarios(scenarios.map((x) => (x.id === s.id ? { ...x, levers } : x)), `Update forecast scenario ${s.name}`)) toast.success(`Updated “${s.name}”`);
  };
  const remove = async (s: ForecastScenario) => {
    if (await saveScenarios(scenarios.filter((x) => x.id !== s.id), `Delete forecast scenario ${s.name}`)) {
      if (loadedId === s.id) setLoadedId(null);
      setShown(shown.filter((x) => x !== s.id));
    }
  };
  const load_ = (s: ForecastScenario) => {
    const next = withDefaults(s.levers);
    setLevers(next);
    persist({ levers: next });
    setLoadedId(s.id);
  };
  const setLever = <K extends keyof Levers>(k: K, v: Levers[K]) => {
    const next = { ...levers, [k]: v };
    setLevers(next);
    persist({ levers: next });
  };
  const shownLines = changed || chosenForecasts.length > 0;
  const val = (p: { netWorth: number; real: number }) => (real ? p.real : p.netWorth);

  const startTotal = BUCKETS.reduce((s, b) => s + read.start[b], 0) - read.liabilities;
  const surplus = base.income - base.expenses - base.sip - base.nps - base.emi;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <div className="space-y-4">
          <SectionCard title="You" description="Horizon runs from today to retirement.">
            <div className="grid grid-cols-2 gap-3">
              <NumField label="Age now" value={age} onChange={bind("age", setAge)} min={18} max={80} />
              <NumField label="Retire at" value={retireAge} onChange={bind("retireAge", setRetireAge)} min={19} max={90} />
            </div>
            {!valid && <p className="mt-2 text-xs text-destructive">Retirement age must be after your age now.</p>}
          </SectionCard>

          <SectionCard title="Starting point" description="Read from your data. Type over a figure to change it." bodyClassName="space-y-3 p-4">
            <NumField label="Take-home pay / month" value={base.income} onChange={(v) => setOv("income", v)} step={1000} />
            <NumField label="Spending / month" value={base.expenses} onChange={(v) => setOv("expenses", v)} step={1000} />
            <NumField label="SIPs / month" value={base.sip} onChange={(v) => setOv("sip", v)} step={500} />
            <p className="text-xs text-muted-foreground">
              Also going in: {money(base.epf)} EPF{base.nps > 0 ? `, ${money(Math.round(base.nps))} NPS` : ""}
              {base.emi > 0 ? `; ${money(base.emi)} EMI paying down loans` : ""}.
            </p>
            {read.notes.map((n) => (
              <p key={n} className="text-xs text-muted-foreground">{n}.</p>
            ))}
            {Object.keys(overrides).length > 0 && (
              <Button variant="ghost" size="sm" className="-ml-2" onClick={() => { setOverrides({}); persist({ overrides: {} }); }}>
                <RotateCcwIcon /> Back to my data
              </Button>
            )}
          </SectionCard>

          <SectionCard title="Assumptions" bodyClassName="space-y-4 p-4">
            <PctSlider label="Equity return" value={equityReturn} onChange={(v) => { setEquityReturn(v); persist({ equityReturn: v }); }} min={0.04} max={0.16} hint={read.equityXirr == null ? "no history, using 11%" : `your funds returned ${(read.equityXirr * 100).toFixed(1)}%; pulled toward 11%`} />
            <PctSlider label="Inflation" value={inflation} onChange={bind("inflation", setInflation)} min={0.02} max={0.1} />
            <PctSlider label="Pay rise per year" value={incomeGrowth} onChange={bind("incomeGrowth", setIncomeGrowth)} min={0} max={0.15} />
            <p className="text-xs text-muted-foreground">EPF {pctText(defaults.returns.epf)}, NPS {pctText(defaults.returns.nps)}, deposits {pctText(defaults.returns.debt)}, cash {pctText(defaults.returns.cash)}. Pre-tax.</p>
          </SectionCard>

          <SectionCard
            title="What if…"
            action={
              changed && (
                <Button variant="ghost" size="sm" onClick={() => { setLevers(NO_LEVERS); persist({ levers: NO_LEVERS }); }}>
                  <RotateCcwIcon /> Reset
                </Button>
              )
            }
            bodyClassName="space-y-4 p-4"
          >
            <NumField label="Change SIPs by (₹ / month)" value={levers.sipDelta} onChange={(v) => setLever("sipDelta", v)} step={1000} allowNegative />
            <PctSlider label="Raise SIPs every year by" value={levers.sipStepUp} onChange={(v) => setLever("sipStepUp", v)} min={0} max={0.2} />
            <PctSlider label="Cut spending by" value={levers.expenseCut} onChange={(v) => setLever("expenseCut", v)} min={0} max={0.5} />
            <PctSlider label="Invest what's left over" value={levers.surplusToEquity} onChange={(v) => setLever("surplusToEquity", v)} min={0} max={1} step={0.05} hint="share of the monthly surplus that goes to equity instead of sitting in cash" />
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>One-off money in or out</Label>
                <Button variant="outline" size="sm" onClick={() => setLever("oneOffs", [...levers.oneOffs, { inYears: 5, amount: -1_000_000 }])}>
                  <PlusIcon /> Add
                </Button>
              </div>
              {levers.oneOffs.map((o, i) => (
                <div key={i} className="flex items-end gap-2">
                  <NumField label="In (years)" value={o.inYears} onChange={(v) => setLever("oneOffs", levers.oneOffs.map((x, j) => (j === i ? { ...x, inYears: v } : x)))} min={0} className="w-20" />
                  <NumField label="Amount (− is spent)" value={o.amount} onChange={(v) => setLever("oneOffs", levers.oneOffs.map((x, j) => (j === i ? { ...x, amount: v } : x)))} step={100000} allowNegative className="flex-1" />
                  <Button variant="ghost" size="icon" aria-label="Remove" onClick={() => setLever("oneOffs", levers.oneOffs.filter((_, j) => j !== i))}>
                    <XIcon />
                  </Button>
                </div>
              ))}
              {!levers.oneOffs.length && <p className="text-xs text-muted-foreground">A wedding, a bonus, a car bought outright.</p>}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label>Life events</Label>
                <Select
                  value=""
                  onValueChange={(k) => setLever("events", [...levers.events, newEvent(k as LifeEvent["kind"])])}
                >
                  <SelectTrigger size="sm" className="w-40" aria-label="Add a life event">
                    <SelectValue placeholder="Add an event" />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(EVENT_LABELS) as LifeEvent["kind"][]).map((k) => (
                      <SelectItem key={k} value={k}>
                        {EVENT_LABELS[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {levers.events.map((e, i) => (
                <div key={i} className="space-y-2 rounded-lg border p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{EVENT_LABELS[e.kind]}</span>
                    <Button variant="ghost" size="icon" className="size-7" aria-label={`Remove ${EVENT_LABELS[e.kind]}`} onClick={() => setLever("events", levers.events.filter((_, j) => j !== i))}>
                      <XIcon />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <NumField label="In (years)" value={e.inYears} onChange={(v) => setEvent(i, { inYears: v })} min={0} step={0.5} />
                    {e.kind === "house" && (
                      <>
                        <NumField label="Price (₹)" value={e.price} onChange={(v) => setEvent(i, { price: v })} step={500_000} />
                        <NumField label="Down payment (%)" value={e.downPct * 100} onChange={(v) => setEvent(i, { downPct: Math.min(1, v / 100) })} max={100} step={5} />
                        <NumField label="Loan rate (%)" value={e.rate * 100} onChange={(v) => setEvent(i, { rate: v / 100 })} step={0.25} />
                        <NumField label="Loan term (years)" value={e.years} onChange={(v) => setEvent(i, { years: Math.max(1, v) })} min={1} />
                      </>
                    )}
                    {e.kind === "child" && (
                      <>
                        <NumField label="Extra / month (today's ₹)" value={e.monthly} onChange={(v) => setEvent(i, { monthly: v })} step={1000} />
                        <NumField label="For (years)" value={e.years} onChange={(v) => setEvent(i, { years: v })} min={1} />
                      </>
                    )}
                    {e.kind === "break" && <NumField label="Months without pay" value={e.months} onChange={(v) => setEvent(i, { months: v })} min={1} />}
                    {e.kind === "raise" && <NumField label="Pay rises by (%)" value={e.pct * 100} onChange={(v) => setEvent(i, { pct: v / 100 })} step={5} />}
                  </div>
                  {e.kind === "house" && <p className="text-xs text-muted-foreground">Counted as property that grows at {pctText(defaults.returns.property)}; rent you'd stop paying isn't included.</p>}
                </div>
              ))}
              {!levers.events.length && <p className="text-xs text-muted-foreground">A house, a child, a break from work, a new job.</p>}
            </div>
          </SectionCard>
        </div>

        <div className="min-w-0 space-y-4">
          {scenario && baseline ? (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <Stat label={`Net worth at ${retireAge}`} value={compactINR(val(scenario.atRetirement))} strong sub={startTotal > 0 ? `${(val(scenario.atRetirement) / startTotal).toFixed(1)}× today's ${compactINR(startTotal)}` : "nothing tracked yet today"} />
                <Stat
                  label={changed ? "vs carrying on as now" : "Carrying on as now"}
                  value={changed ? `${val(scenario.atRetirement) >= val(baseline.atRetirement) ? "+" : "−"}${compactINR(Math.abs(val(scenario.atRetirement) - val(baseline.atRetirement)))}` : compactINR(val(baseline.atRetirement))}
                  tone={changed ? (val(scenario.atRetirement) >= val(baseline.atRetirement) ? "positive" : "negative") : undefined}
                  sub={changed ? `${compactINR(val(baseline.atRetirement))} without your changes` : "change something on the left"}
                />
                <Stat
                  label="Could fund per month"
                  value={compactINR(scenario.sustainableMonthly)}
                  sub={`${base.expenses > 0 ? `${Math.round((scenario.sustainableMonthly / base.expenses) * 100)}% of today's spending, ` : ""}4% a year, today's rupees`}
                />
              </div>

              {scenario.cashRunsOutOn && (
                <div className="flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm">
                  <AlertTriangleIcon className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  Your bank balance goes below zero in {monthLabel(scenario.cashRunsOutOn)}: spending plus investing is more than you earn. Cut spending or SIPs, or invest less of the surplus.
                </div>
              )}
              {surplus < 0 && !scenario.cashRunsOutOn && (
                <p className="text-xs text-muted-foreground">Today you spend and invest {money(-surplus)} a month more than you take home; savings in the bank cover it for now.</p>
              )}

              <SectionCard title="Scenarios" description="Save the changes on the left to compare them on the chart." bodyClassName="space-y-3 p-4">
                {scenarios.length === 0 && <p className="text-sm text-muted-foreground">Nothing saved yet. Change something on the left, name it and save.</p>}
                {scenarios.map((s) => {
                  const on = shown.includes(s.id);
                  const dirty = loadedId === s.id && !sameLevers(s.levers, levers);
                  return (
                    <div key={s.id} className="flex items-start gap-3 rounded-lg border p-3">
                      <Checkbox
                        className="mt-1"
                        checked={on}
                        disabled={!on && shown.length >= SCENARIO_COLORS.length}
                        onCheckedChange={(v) => toggle(s.id, v === true)}
                        aria-label={`Show ${s.name} on the chart`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          {on && <span className="size-2.5 rounded-full" style={{ background: SCENARIO_COLORS[shown.indexOf(s.id)] }} />}
                          {s.name}
                          {loadedId === s.id && <span className="text-xs font-normal text-muted-foreground">{dirty ? "editing, unsaved changes" : "loaded"}</span>}
                        </div>
                        <div className="text-xs text-muted-foreground">{describeLevers(s.levers)}</div>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        {dirty && (
                          <Button variant="outline" size="sm" disabled={busy} onClick={() => update(s)}>
                            <SaveIcon /> Update
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => load_(s)} disabled={loadedId === s.id && !dirty}>
                          <UploadIcon /> Load
                        </Button>
                        <Button variant="ghost" size="icon" className="size-8" aria-label={`Delete ${s.name}`} disabled={busy} onClick={() => remove(s)}>
                          <Trash2Icon />
                        </Button>
                      </div>
                    </div>
                  );
                })}
                {changed && !drafted && (
                  <form
                    className="flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      saveAsNew();
                    }}
                  >
                    <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name these changes, e.g. “Aggressive SIPs”" maxLength={60} aria-label="Scenario name" />
                    <Button type="submit" disabled={busy || !name.trim()}>
                      <SaveIcon /> Save scenario
                    </Button>
                  </form>
                )}
                {changed && drafted && !loaded && <p className="text-xs text-muted-foreground">These changes match a saved scenario.</p>}
              </SectionCard>

              <SectionCard
                title="Net worth to retirement"
                subtitle={real ? "in today's rupees" : "in future rupees"}
                action={
                  <div className="flex gap-1">
                    <Button size="sm" variant={real ? "secondary" : "ghost"} onClick={() => setReal(true)}>Today's ₹</Button>
                    <Button size="sm" variant={real ? "ghost" : "secondary"} onClick={() => setReal(false)}>Future ₹</Button>
                  </div>
                }
              >
                <LineChart
                  label="Forecast net worth"
                  bands={sim ? [{ key: "range", label: "Likely range (10th–90th percentile)", color: changed ? DRAFT_COLOR : "var(--chart-1)", points: sim.bands.map((b) => ({ date: b.date, lo: (real ? b.real : b.nominal).p10, hi: (real ? b.real : b.nominal).p90 })) }] : []}
                  series={[
                    { key: "base", label: shownLines ? "Carrying on as now" : "Forecast", color: "var(--chart-1)", dashed: shownLines, points: baseline.points.map((p) => ({ date: p.date, v: val(p) })) },
                    ...chosenForecasts.map(({ s, f }) => ({ key: s.id, label: s.name, color: SCENARIO_COLORS[shown.indexOf(s.id)], points: f.points.map((p) => ({ date: p.date, v: val(p) })) })),
                    ...(changed && !drafted ? [{ key: "draft", label: "Unsaved changes", color: DRAFT_COLOR, points: scenario.points.map((p) => ({ date: p.date, v: val(p) })) }] : []),
                  ]}
                />
              </SectionCard>

              {impactRows.length > 0 && (
                <SectionCard title="What moves the needle" description="Net worth at retirement, in today's rupees, if you made just this one change." padded={false}>
                  <Table>
                    <TableBody>
                      {impactRows.map((row) => (
                        <TableRow key={row.label}>
                          <TableCell className="pl-4 whitespace-normal">{row.label}</TableCell>
                          <TableCell className={cn("text-right font-medium tabular-nums", row.delta > 0 ? "text-positive" : "text-destructive")}>
                            {row.delta > 0 ? "+" : "−"}
                            {compactINR(Math.abs(row.delta))}
                          </TableCell>
                          <TableCell className="w-24 pr-4 text-right">
                            {row.levers ? (
                              <Button variant="ghost" size="sm" onClick={() => { setLevers(row.levers!); persist({ levers: row.levers! }); }}>
                                Apply
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">not a choice</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </SectionCard>
              )}

              {sim && (
                <SectionCard
                  title="How sure is this?"
                  description={`${sim.runs.toLocaleString("en-IN")} simulated markets for ${changed ? "your changes" : "carrying on as now"}. The line above is one steady path; real markets won't be.`}
                  bodyClassName="space-y-4 p-4"
                >
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Stat label={`Likely range at ${retireAge}`} value={`${compactINR(real ? sim.final.p10 : sim.bands.at(-1)!.nominal.p10)} – ${compactINR(real ? sim.final.p90 : sim.bands.at(-1)!.nominal.p90)}`} sub={`middle outcome ${compactINR(real ? sim.final.p50 : sim.bands.at(-1)!.nominal.p50)}; 8 in 10 land inside`} />
                    <Stat
                      label={`Chance of ${compactINR(goalTarget)}+`}
                      value={`${Math.round(sim.chanceAtLeast(goalTarget) * 100)}%`}
                      tone={sim.chanceAtLeast(goalTarget) >= 0.75 ? "positive" : sim.chanceAtLeast(goalTarget) < 0.5 ? "negative" : undefined}
                      sub="in today's rupees, by retirement"
                    />
                    <Stat label="Chance the bank runs dry" value={`${Math.round(sim.cashOutChance * 100)}%`} tone={sim.cashOutChance > 0.1 ? "negative" : undefined} sub="at some point before retirement" />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <PctSlider label="How much equity swings in a year" value={equityVol} onChange={(v) => { setEquityVol(v); persist({ equityVol: v }); }} min={0.08} max={0.3} step={0.01} hint="Indian equity has swung around 15–20% a year; wider means a wider range" />
                    <NumField label="Retirement target (today's ₹)" value={goalTarget} onChange={(v) => { setTarget(v); persist({ target: v }); }} step={1_000_000} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {target == null ? `Starts at 25× today's yearly spending (${compactINR(defaultTarget)}), the corpus a 4% withdrawal would live on. ` : ""}The range is the 10th to 90th percentile of the runs: a poor market and a good one, not the extremes.
                  </p>
                </SectionCard>
              )}

              {goalChances.length > 0 && (
                <SectionCard title="Your goals" description="Chance each goal's linked funds reach its target by its date, using the same swings." padded={false}>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-4">Goal</TableHead>
                        <TableHead className="text-right">Target</TableHead>
                        <TableHead className="text-right">On a steady path</TableHead>
                        <TableHead className="pr-4 text-right">Chance</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {goalChances.map(({ goal, p, chance }) => (
                        <TableRow key={goal.id}>
                          <TableCell className="pl-4 whitespace-normal">
                            <div className="font-medium">{goal.name}</div>
                            <div className="text-xs text-muted-foreground">by {goal.date}, {p.months} months left</div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{compactINR(goal.target)}</TableCell>
                          <TableCell className="text-right tabular-nums">{compactINR(p.projected)}</TableCell>
                          <TableCell className={cn("pr-4 text-right font-medium tabular-nums", chance >= 0.75 ? "text-positive" : chance < 0.5 ? "text-destructive" : "text-amber-700 dark:text-amber-400")}>{Math.round(chance * 100)}%</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </SectionCard>
              )}

              {chosenForecasts.length > 0 && (
                <SectionCard title="Compare" padded={false}>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-4">Scenario</TableHead>
                        <TableHead className="text-right">At {retireAge}</TableHead>
                        <TableHead className="text-right">vs now-path</TableHead>
                        <TableHead className="pr-4 text-right">Could fund / month</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[{ id: "base", name: "Carrying on as now", f: baseline }, ...chosenForecasts.map(({ s, f }) => ({ id: s.id, name: s.name, f }))].map((row) => {
                        const diff = val(row.f.atRetirement) - val(baseline.atRetirement);
                        return (
                          <TableRow key={row.id}>
                            <TableCell className="pl-4 whitespace-normal">
                              {row.name}
                              {row.f.cashRunsOutOn && <span className="ml-2 text-xs text-destructive">cash runs out {monthLabel(row.f.cashRunsOutOn)}</span>}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{compactINR(val(row.f.atRetirement))}</TableCell>
                            <TableCell className={cn("text-right tabular-nums", diff > 0 && "text-positive", diff < 0 && "text-destructive")}>{row.id === "base" ? "—" : `${diff >= 0 ? "+" : "−"}${compactINR(Math.abs(diff))}`}</TableCell>
                            <TableCell className="pr-4 text-right tabular-nums">{compactINR(row.f.sustainableMonthly)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </SectionCard>
              )}

              <SectionCard title={`Where it sits at ${retireAge}`} padded={false}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4">Asset</TableHead>
                      <TableHead className="text-right">Today</TableHead>
                      <TableHead className="pr-4 text-right">At {retireAge}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {BUCKETS.filter((b) => read.start[b] !== 0 || scenario.atRetirement.buckets[b] !== 0).map((b) => (
                      <TableRow key={b}>
                        <TableCell className="pl-4">{BUCKET_LABELS[b]}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(read.start[b])}</TableCell>
                        <TableCell className={cn("pr-4 text-right tabular-nums", scenario.atRetirement.buckets[b] < 0 && "text-destructive")}>{money(deflate(scenario.atRetirement.buckets[b]))}</TableCell>
                      </TableRow>
                    ))}
                    {(read.liabilities > 0 || scenario.atRetirement.liabilities > 0) && (
                      <TableRow>
                        <TableCell className="pl-4">Loans and dues</TableCell>
                        <TableCell className="text-right tabular-nums">−{money(read.liabilities)}</TableCell>
                        <TableCell className="pr-4 text-right tabular-nums">−{money(deflate(scenario.atRetirement.liabilities))}</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </SectionCard>
              <p className="text-xs text-muted-foreground">
                A single steady-return line, not a range: markets won't behave. Pre-tax, and loans are paid down by your EMI with no interest cost. Mutual funds are treated as equity even if some are debt funds.
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Set a retirement age after your current age to see the forecast.</p>
          )}
        </div>
      </div>
    </div>
  );

  function deflate(v: number) {
    return real ? v / Math.pow(1 + inflation, retireAge - age) : v;
  }
  function setOv(k: keyof Overrides, v: number) {
    const next = { ...overrides, [k]: v };
    setOverrides(next);
    persist({ overrides: next });
  }
}

const pctText = (n: number) => `${(n * 100).toFixed(n * 1000 % 10 ? 2 : 1).replace(/\.?0+$/, "")}%`;

function Stat({ label, value, sub, strong, tone }: { label: string; value: string; sub?: string; strong?: boolean; tone?: "positive" | "negative" }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-1 tabular-nums", strong ? "text-2xl font-semibold" : "text-xl font-medium", tone === "positive" && "text-positive", tone === "negative" && "text-destructive")}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

/** A number box that keeps what's being typed (including "-" or an empty box) until it parses. */
function NumField({ label, value, onChange, min, max, step, allowNegative, className }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; allowNegative?: boolean; className?: string }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label>{label}</Label>
      <Input
        type="number"
        inputMode={allowNegative ? "text" : "decimal"}
        value={text ?? String(Math.round(value * 100) / 100)}
        min={min ?? (allowNegative ? undefined : 0)}
        max={max}
        step={step}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value !== "" && Number.isFinite(n)) onChange(Math.min(max ?? Infinity, Math.max(min ?? (allowNegative ? -Infinity : 0), n)));
        }}
        onBlur={() => setText(null)}
      />
    </div>
  );
}

function PctSlider({ label, value, onChange, min, max, step = 0.005, hint }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number; hint?: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <Label>{label}</Label>
        <span className="text-sm tabular-nums">{pctText(value)}</span>
      </div>
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={([v]) => onChange(Math.round(v * 1000) / 1000)} aria-label={label} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
