import { CheckCircle2Icon, CircleIcon, Loader2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { SYNC_STAGES, type SyncProgress } from "@/lib/sync";
import { cn } from "@/lib/utils";

/** What the sync has reported so far: the latest state plus every extracted record and step. */
export interface SyncActivity {
  latest: SyncProgress;
  items: { account?: string; text: string }[];
  steps: { account?: string; text: string }[];
}

/** Folds one progress event into the running activity. */
export function addActivity(prev: SyncActivity | null, p: SyncProgress): SyncActivity {
  const items = prev?.items ?? [];
  const steps = prev?.steps ?? [];
  const lastStep = steps.at(-1);
  return {
    latest: p,
    items: p.item ? [...items, { account: p.account, text: p.item }] : items,
    steps: !p.item && lastStep?.text !== p.message ? [...steps, { account: p.account, text: p.message }].slice(-200) : steps,
  };
}

const COUNTS: { key: keyof SyncProgress["found"]; label: string }[] = [
  { key: "transactions", label: "Transactions" },
  { key: "updated", label: "Updated" },
  { key: "cardStatements", label: "Card bills" },
  { key: "cardPayments", label: "Card payments" },
  { key: "wealth", label: "NPS updates" },
  { key: "payroll", label: "Payslips / Form 16" },
  { key: "statements", label: "CAS" },
];

/** Progress bar for a running sync; click it for the details in a dialog. */
export function SyncStatus({ activity }: { activity: SyncActivity }) {
  const [open, setOpen] = useState(false);
  const { latest } = activity;
  const pct = Math.round(latest.fraction * 100);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Show sync details"
        className="hidden w-56 flex-col gap-1 rounded-md px-2 py-1 text-left hover:bg-muted sm:flex"
      >
        <span className="truncate text-xs text-muted-foreground">
          {latest.account && <b className="font-medium">{latest.account}: </b>}
          {latest.message}
        </span>
        <Progress value={pct} />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] gap-4 overflow-hidden sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Syncing {pct}%</DialogTitle>
            <DialogDescription>
              {latest.account ? `Inbox ${Math.min(latest.accountIndex + 1, latest.accountCount)} of ${latest.accountCount}: ${latest.account}` : latest.message}
            </DialogDescription>
          </DialogHeader>
          <Progress value={pct} />
          <p className="flex items-center gap-2 text-sm">
            <Loader2Icon className="size-4 shrink-0 animate-spin text-muted-foreground" />
            {latest.message}
          </p>

          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
            {SYNC_STAGES.map((name, i) => {
              const state = latest.stage === undefined ? "todo" : i < latest.stage ? "done" : i === latest.stage ? "active" : "todo";
              return (
                <span key={name} className={cn("flex items-center gap-1.5 text-sm", state === "todo" && "text-muted-foreground")}>
                  {state === "done" ? (
                    <CheckCircle2Icon className="size-4 text-primary" />
                  ) : state === "active" ? (
                    <Loader2Icon className="size-4 animate-spin" />
                  ) : (
                    <CircleIcon className="size-4" />
                  )}
                  {name}
                </span>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-1.5">
            {COUNTS.filter((c) => latest.found[c.key] > 0 || c.key === "transactions").map((c) => (
              <Badge key={c.key} variant="secondary">
                {latest.found[c.key]} {c.label.toLowerCase()}
              </Badge>
            ))}
          </div>

          <Separator />
          <Log title="Extracted so far" empty="Nothing extracted yet" lines={activity.items} open={open} />
          <Log title="Steps" lines={activity.steps} open={open} className="max-h-32" />
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Newest line at the bottom; sticks to the bottom unless the user has scrolled up. */
function Log({ title, lines, empty, className, open }: { title: string; lines: { account?: string; text: string }[]; empty?: string; className?: string; open: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight;
  }, [lines.length]);
  useEffect(() => {
    if (open && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [open]);
  const multi = new Set(lines.map((l) => l.account)).size > 1;
  return (
    <div className="min-h-0 space-y-1.5">
      <h4 className="text-sm font-medium">
        {title} {lines.length > 0 && <span className="font-normal text-muted-foreground">({lines.length})</span>}
      </h4>
      <div ref={ref} className={cn("max-h-56 space-y-0.5 overflow-y-auto rounded-md border bg-muted/30 p-2 font-mono text-xs", className)}>
        {lines.length === 0 && <p className="text-muted-foreground">{empty ?? "…"}</p>}
        {lines.map((l, i) => (
          <p key={i} className="break-words">
            {multi && l.account && <span className="text-muted-foreground">{l.account} · </span>}
            {l.text}
          </p>
        ))}
      </div>
    </div>
  );
}
