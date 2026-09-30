import { useState } from "react";
import { Loader2Icon, SearchIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { discoverSenders, type SenderCandidate } from "@/lib/discover";
import type { LeafConfig } from "@/types";

interface Props {
  account: string;
  config: LeafConfig;
  disabled?: boolean;
  onSave: (next: LeafConfig) => Promise<boolean>;
}

/** Scan one inbox for money-looking emails from senders Leaf doesn't read yet, and add the chosen ones. */
export default function FindSenders({ account, config, disabled, onSave }: Props) {
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<SenderCandidate[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const scan = async () => {
    setOpen(true);
    setCandidates(null);
    setPicked(new Set());
    setProgress("Searching…");
    try {
      const found = await discoverSenders(account, (config.extraSenders ?? []).map((x) => x.sender), (n, total) => setProgress(`Checking ${n}/${total} emails…`));
      setCandidates(found);
    } catch (e) {
      toast.error("Couldn't scan this inbox", { description: (e as Error).message });
      setOpen(false);
    } finally {
      setProgress(null);
    }
  };

  const add = async () => {
    const now = Math.floor(Date.now() / 1000);
    const extraSenders = [...(config.extraSenders ?? []), ...[...picked].map((sender) => ({ sender, addedAt: now }))];
    if (await onSave({ ...config, extraSenders })) {
      toast.success(`Added ${picked.size} sender${picked.size === 1 ? "" : "s"}. The next Sync reads their last 90 days.`);
      setOpen(false);
    }
  };

  return (
    <>
      <Button variant="ghost" size="sm" onClick={scan} disabled={disabled}>
        <SearchIcon /> Find senders
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Senders Leaf isn't reading yet</DialogTitle>
            <DialogDescription>
              Emails in {account} from the last 6 months that mention money being debited, credited or salary. Tick the ones that are
              real alerts (a bank, your employer's payroll) and Leaf will include them.
            </DialogDescription>
          </DialogHeader>
          {progress ? (
            <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" /> {progress}
            </p>
          ) : candidates?.length ? (
            <ul className="max-h-[50vh] divide-y overflow-y-auto">
              {candidates.map((c) => (
                <li key={c.sender} className="flex gap-3 py-2.5">
                  <Checkbox
                    id={c.sender}
                    className="mt-0.5"
                    checked={picked.has(c.sender)}
                    onCheckedChange={(v) =>
                      setPicked((p) => {
                        const next = new Set(p);
                        if (v === true) next.add(c.sender);
                        else next.delete(c.sender);
                        return next;
                      })
                    }
                  />
                  <label htmlFor={c.sender} className="min-w-0 flex-1 cursor-pointer text-sm">
                    <div className="font-medium">
                      {c.sender} <span className="font-normal text-muted-foreground">· {c.count} emails</span>
                    </div>
                    {c.subjects.map((s) => (
                      <div key={s} className="truncate text-xs text-muted-foreground">
                        {s}
                      </div>
                    ))}
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-6 text-sm text-muted-foreground">Nothing new: every money-related sender here is already covered.</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button onClick={add} disabled={!picked.size}>
              Add {picked.size || ""} sender{picked.size === 1 ? "" : "s"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
