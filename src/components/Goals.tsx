import { useMemo, useState } from "react";
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ViewProps } from "@/App";
import type { Goal } from "@/types";
import { day, money } from "@/lib/format";
import { projectGoal } from "@/lib/goals";
import type { SchemeSummary } from "@/lib/portfolio";
import { sips } from "@/lib/sips";
import { cn } from "@/lib/utils";
import SectionCard from "./SectionCard";

const today = () => new Date().toISOString().slice(0, 10);
const blank = (): Goal => ({ id: crypto.randomUUID(), name: "", target: 0, date: "", schemes: [], returnPct: 10 });

export default function Goals({ store, data, setData, schemes }: Pick<ViewProps, "store" | "data" | "setData"> & { schemes: SchemeSummary[] }) {
  const goals = data.config.goals ?? [];
  const plans = useMemo(() => sips(data.statements).plans, [data.statements]);
  const [editing, setEditing] = useState<Goal | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (next: Goal[], message: string) => {
    setBusy(true);
    try {
      const config = { ...data.config, goals: next };
      await store.writeJSON({ "config.json": config }, message);
      setData({ ...data, config });
      return true;
    } catch (e) {
      toast.error("Couldn't save goals", { description: (e as Error).message });
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
    <SectionCard
      title="Goals"
      description="Earmark funds for a goal and see whether your SIPs get you there."
      action={
        <Button variant="outline" onClick={() => setEditing(blank())} disabled={!schemes.length}>
          <PlusIcon />
          Add goal
        </Button>
      }
    >
      <div className="space-y-3">
        {goals.length === 0 && <p className="text-sm text-muted-foreground">No goals yet. Add one, such as a house down payment, and link the schemes that fund it.</p>}
        {goals.map((g) => {
          const p = projectGoal(g, schemes, plans, today());
          const gap = g.target - p.projected;
          return (
            <div key={g.id} className="space-y-3 rounded-lg border p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium">{g.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {money(g.target)} by {day(g.date)} · {p.months} month{p.months === 1 ? "" : "s"} left · assuming {g.returnPct}% a year
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <span className={cn("mr-2 rounded-full px-2 py-0.5 text-xs font-medium", p.onTrack ? "bg-positive/10 text-positive" : "bg-amber-500/10 text-amber-700 dark:text-amber-400")}>
                    {p.onTrack ? "On track" : "Behind"}
                  </span>
                  <Button variant="ghost" size="icon" aria-label={`Edit ${g.name}`} onClick={() => setEditing(g)}>
                    <PencilIcon />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label={`Delete ${g.name}`} disabled={busy} onClick={() => save(goals.filter((x) => x.id !== g.id), `Delete goal ${g.name}`)}>
                    <Trash2Icon />
                  </Button>
                </div>
              </div>

              <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(Math.min(1, p.progress) * 100)} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(1, p.progress) * 100}%` }} />
              </div>

              <div className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                <Fact label="Saved so far" value={`${money(p.current)} (${(p.progress * 100).toFixed(0)}%)`} />
                <Fact label={p.fromSips ? "Going in (from SIPs)" : "Going in"} value={`${money(p.monthly)} / month`} />
                <Fact label="Projected" value={money(p.projected)} tone={p.onTrack ? "positive" : "negative"} />
              </div>
              {!p.onTrack && p.months > 0 && (
                <p className="text-sm">
                  Short by <b>{money(gap)}</b>. Investing <b>{money(p.required)}</b> a month would close it, {p.required > p.monthly ? `${money(p.required - p.monthly)} more than now` : "less than now"}.
                </p>
              )}
              {p.months === 0 && <p className="text-sm text-muted-foreground">The target date has passed or is this month.</p>}
              {p.missing.length > 0 && <p className="text-xs text-amber-700 dark:text-amber-400">No longer in your portfolio: {p.missing.join("; ")}.</p>}
            </div>
          );
        })}
        <p className="text-xs text-muted-foreground">Projections assume a steady return and don't account for tax, inflation or market swings.</p>
      </div>
    </SectionCard>

      <GoalDialog
        goal={editing}
        schemes={schemes}
        busy={busy}
        onClose={() => setEditing(null)}
        onSave={async (g) => {
          const exists = goals.some((x) => x.id === g.id);
          if (await save(exists ? goals.map((x) => (x.id === g.id ? g : x)) : [...goals, g], `${exists ? "Update" : "Add"} goal ${g.name}`)) setEditing(null);
        }}
      />
    </>
  );
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: "positive" | "negative" }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("tabular-nums", tone === "positive" && "text-positive", tone === "negative" && "text-destructive")}>{value}</div>
    </div>
  );
}

function GoalDialog({ goal, schemes, busy, onClose, onSave }: { goal: Goal | null; schemes: SchemeSummary[]; busy: boolean; onClose: () => void; onSave: (g: Goal) => void }) {
  return (
    <Dialog open={!!goal} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">{goal && <GoalForm key={goal.id} goal={goal} schemes={schemes} busy={busy} onSave={onSave} />}</DialogContent>
    </Dialog>
  );
}

function GoalForm({ goal, schemes, busy, onSave }: { goal: Goal; schemes: SchemeSummary[]; busy: boolean; onSave: (g: Goal) => void }) {
  const [name, setName] = useState(goal.name);
  const [target, setTarget] = useState(goal.target ? String(goal.target) : "");
  const [date, setDate] = useState(goal.date);
  const [ret, setRet] = useState(String(goal.returnPct));
  const [monthly, setMonthly] = useState(goal.monthly != null ? String(goal.monthly) : "");
  const [picked, setPicked] = useState(new Set(goal.schemes));

  const ok = name.trim() && Number(target) > 0 && date > today() && picked.size > 0 && Number(ret) >= 0 && Number(ret) <= 30;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ id: goal.id, name: name.trim(), target: Number(target), date, schemes: [...picked], returnPct: Number(ret), monthly: monthly === "" ? undefined : Number(monthly) });
      }}
    >
      <DialogHeader>
        <DialogTitle>{goal.name ? "Edit goal" : "New goal"}</DialogTitle>
        <DialogDescription>Pick the schemes that fund it. Their value counts towards the target.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="g-name">Name</Label>
          <Input id="g-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="House down payment" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="g-target">Target amount (₹)</Label>
          <Input id="g-target" inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value.replace(/[^\d]/g, ""))} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="g-date">Needed by</Label>
          <Input id="g-date" type="date" min={today()} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="g-ret">Expected return (% a year)</Label>
          <Input id="g-ret" inputMode="decimal" value={ret} onChange={(e) => setRet(e.target.value.replace(/[^\d.]/g, ""))} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="g-monthly">Monthly investment (₹)</Label>
          <Input id="g-monthly" inputMode="numeric" value={monthly} placeholder="Use my SIPs" onChange={(e) => setMonthly(e.target.value.replace(/[^\d]/g, ""))} />
        </div>
      </div>
      <fieldset className="space-y-1.5">
        <legend className="mb-1 text-sm font-medium">Schemes</legend>
        <div className="max-h-52 space-y-1 overflow-y-auto rounded-lg border p-2">
          {schemes.map((s) => (
            <label key={s.name} className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/50">
              <Checkbox
                className="mt-0.5"
                checked={picked.has(s.name)}
                onCheckedChange={(c) => setPicked((prev) => new Set(c ? [...prev, s.name] : [...prev].filter((n) => n !== s.name)))}
              />
              <span className="flex-1">{s.name}</span>
              <span className="tabular-nums text-muted-foreground">{money(s.value)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <DialogFooter>
        <Button disabled={!ok || busy}>Save goal</Button>
      </DialogFooter>
    </form>
  );
}
