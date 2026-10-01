import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ViewProps } from "@/App";
import { money } from "@/lib/format";
import { ASSET_CLASSES, type AssetClass, type SchemeSummary } from "@/lib/portfolio";
import { rebalance, targetTotal, type Targets } from "@/lib/rebalance";
import { cn } from "@/lib/utils";
import SectionCard from "./SectionCard";

const BAND = 5; // percentage points of drift worth acting on

export default function Rebalance({ store, data, setData, schemes }: Pick<ViewProps, "store" | "data" | "setData"> & { schemes: SchemeSummary[] }) {
  const saved = (data.config.rebalanceTargets ?? {}) as Targets;
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(ASSET_CLASSES.map((c) => [c, saved[c] != null ? String(saved[c]) : ""])));
  const [newMoney, setNewMoney] = useState("");
  const [busy, setBusy] = useState(false);

  const targets: Targets = useMemo(() => {
    const t: Targets = {};
    for (const c of ASSET_CLASSES) {
      const n = Number(draft[c]);
      if (draft[c] !== "" && Number.isFinite(n) && n >= 0) t[c] = n;
    }
    return t;
  }, [draft]);
  const total = targetTotal(targets);
  const valid = Math.abs(total - 100) < 0.01;
  const dirty = JSON.stringify(targets) !== JSON.stringify(saved);
  const rows = useMemo(() => rebalance(schemes, valid ? targets : {}, Number(newMoney) > 0 ? Number(newMoney) : 0), [schemes, targets, valid, newMoney]);

  const save = async () => {
    setBusy(true);
    try {
      const config = { ...data.config, rebalanceTargets: targets as Record<string, number> };
      await store.writeJSON({ "config.json": config }, "Set rebalancing targets");
      setData({ ...data, config });
      toast.success("Targets saved");
    } catch (e) {
      toast.error("Couldn't save targets", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const active = valid && rows.some((r) => r.target != null);
  const out = rows.filter((r) => active && Math.abs(r.drift) >= BAND);

  return (
    <SectionCard title="Rebalancing" description="Set the mix you want. Leaf shows how far you've drifted and where new money should go." bodyClassName="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Asset class</TableHead>
            <TableHead className="text-right">Value</TableHead>
            <TableHead className="text-right">Now</TableHead>
            <TableHead className="w-28 text-right">Target %</TableHead>
            <TableHead className="text-right">Drift</TableHead>
            <TableHead className="text-right">To reach target</TableHead>
            {Number(newMoney) > 0 && active && <TableHead className="text-right">New money</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {ASSET_CLASSES.map((c: AssetClass) => {
            const r = rows.find((x) => x.cls === c);
            return (
              <TableRow key={c}>
                <TableCell className="font-medium">{c}</TableCell>
                <TableCell className="text-right tabular-nums">{r ? money(r.value) : "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{r ? `${(r.share * 100).toFixed(1)}%` : "0%"}</TableCell>
                <TableCell className="text-right">
                  <Input
                    inputMode="decimal"
                    className="ml-auto h-8 w-20 text-right tabular-nums"
                    placeholder="—"
                    value={draft[c]}
                    onChange={(e) => setDraft({ ...draft, [c]: e.target.value.replace(/[^\d.]/g, "") })}
                  />
                </TableCell>
                <TableCell className={cn("text-right tabular-nums", r?.target != null && Math.abs(r.drift) >= BAND && "font-medium text-amber-600 dark:text-amber-400")}>
                  {r?.target != null ? `${r.drift > 0 ? "+" : ""}${r.drift.toFixed(1)} pts` : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r?.target == null ? "—" : Math.abs(r.toTarget) < 1 ? "On target" : `${r.toTarget > 0 ? "Buy" : "Sell"} ${money(Math.abs(r.toTarget))}`}
                </TableCell>
                {Number(newMoney) > 0 && active && <TableCell className="text-right tabular-nums">{r && r.newMoney >= 1 ? money(r.newMoney) : "—"}</TableCell>}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground" htmlFor="new-money">
            New money to invest (optional)
          </label>
          <Input id="new-money" inputMode="numeric" className="w-44 tabular-nums" placeholder="₹" value={newMoney} onChange={(e) => setNewMoney(e.target.value.replace(/[^\d]/g, ""))} />
        </div>
        <div className="flex items-center gap-3">
          <span className={cn("text-sm tabular-nums", valid ? "text-muted-foreground" : total > 0 ? "text-destructive" : "text-muted-foreground")}>
            Targets add up to {total.toFixed(total % 1 ? 1 : 0)}%{!valid && total > 0 && " (needs 100)"}
          </span>
          <Button onClick={save} disabled={!valid || !dirty || busy}>
            Save targets
          </Button>
        </div>
      </div>

      {active && (
        <p className="text-sm text-muted-foreground">
          {out.length
            ? `${out.map((r) => r.cls).join(" and ")} ${out.length === 1 ? "is" : "are"} ${BAND}+ points off target. `
            : `Every class is within ${BAND} points of target. `}
          Putting new money in the underweight classes is the cheapest way to rebalance: selling can trigger capital gains tax.
        </p>
      )}
    </SectionCard>
  );
}
