import { useState } from "react";
import { Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ViewProps } from "@/App";
import { PATHS } from "@/lib/db";
import { manualBalance } from "@/lib/documents";
import { money } from "@/lib/format";
import { newAccountId, removeAccount, WEALTH_KINDS, type WealthData } from "@/lib/wealth";
import type { WealthAccount, WealthKind } from "@/types";
import ConfirmDialog from "./ConfirmDialog";

export const wealthFiles = (d: WealthData) => ({
  [PATHS.wealthAccounts]: d.accounts,
  [PATHS.wealthSnapshots]: d.snapshots,
  [PATHS.wealthFlows]: d.flows,
});

export interface Editing {
  account: WealthAccount;
  isNew: boolean;
}

/** Add, update (a balance as of a date) or delete a tracked account, saving to the data repo. */
export default function AccountEditor({ store, data, reload, editing, onClose }: Pick<ViewProps, "store" | "data" | "reload"> & { editing: Editing; onClose: () => void }) {
  const current = { accounts: data.wealthAccounts, snapshots: data.wealthSnapshots, flows: data.wealthFlows };

  const deleteAccount = async (account: WealthAccount) => {
    try {
      // Remember the id so a later Sync doesn't rebuild the account from the same emails.
      const config = { ...data.config, deletedAccounts: [...new Set([...(data.config.deletedAccounts ?? []), account.id])] };
      await store.writeJSON({ ...wealthFiles(removeAccount(current, account.id)), "config.json": config }, `Delete ${account.name}`);
      await reload();
      onClose();
      toast.success(`Deleted ${account.name}`);
    } catch (e) {
      toast.error("Couldn't delete", { description: (e as Error).message });
    }
  };

  return (
    <EditAccount
      account={editing.account}
      isNew={editing.isNew}
      counts={{ balances: data.wealthSnapshots.filter((x) => x.account === editing.account.id).length, flows: data.wealthFlows.filter((x) => x.account === editing.account.id).length }}
      onDelete={deleteAccount}
      onClose={onClose}
      onSave={async (account, value, date) => {
        try {
          const files = manualBalance(data, account, value, date);
          // Keep edits to name/institution made in the dialog.
          files[PATHS.wealthAccounts] = (files[PATHS.wealthAccounts] as WealthAccount[]).map((a) => (a.id === account.id ? account : a));
          await store.writeJSON(files, `${editing.isNew ? "Add" : "Update"} ${account.name}`);
          await reload();
          onClose();
          toast.success(`${account.name}: ${money(value)}`);
        } catch (e) {
          toast.error("Couldn't save", { description: (e as Error).message });
        }
      }}
    />
  );
}

function EditAccount({
  account,
  isNew,
  counts,
  onDelete,
  onClose,
  onSave,
}: {
  account: WealthAccount;
  isNew: boolean;
  counts: { balances: number; flows: number };
  onDelete: (account: WealthAccount) => Promise<void>;
  onClose: () => void;
  onSave: (account: WealthAccount, value: number, date: string) => Promise<void>;
}) {
  const [a, setA] = useState(account);
  const [value, setValue] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const amount = Number(value.replace(/,/g, ""));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            await onSave({ ...a, name: a.name.trim() || WEALTH_KINDS[a.kind].label }, amount, date);
            setBusy(false);
          }}
        >
          <DialogHeader>
            <DialogTitle>{isNew ? "Add account" : `Update ${account.name}`}</DialogTitle>
            <DialogDescription>
              {isNew ? "For anything not in your email or a document. " : ""}Enter the balance as of a date; for loans, the principal outstanding.
            </DialogDescription>
          </DialogHeader>
          {isNew && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={a.kind} onValueChange={(k) => setA({ ...a, kind: k as WealthKind, id: newAccountId(k as WealthKind) })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(WEALTH_KINDS) as WealthKind[]).map((k) => (
                      <SelectItem key={k} value={k}>
                        {WEALTH_KINDS[k].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="inst">Institution</Label>
                <Input id="inst" placeholder="EPFO, SBI, HDFC…" value={a.institution ?? ""} onChange={(e) => setA({ ...a, institution: e.target.value })} />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="name">Name</Label>
                <Input id="name" placeholder={WEALTH_KINDS[a.kind].label} value={a.name} onChange={(e) => setA({ ...a, name: e.target.value })} />
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="value">{WEALTH_KINDS[a.kind].liability ? "Outstanding" : "Balance"} (₹)</Label>
              <Input id="value" autoFocus inputMode="decimal" className="tabular-nums" value={value} onChange={(e) => setValue(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="date">As of</Label>
              <Input id="date" type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <DialogFooter className="sm:justify-between">
            {isNew ? (
              <span />
            ) : (
              <ConfirmDialog
                trigger={
                  <Button type="button" variant="ghost" className="text-destructive hover:text-destructive">
                    <Trash2Icon /> Delete
                  </Button>
                }
                title={`Delete ${account.name}?`}
                description={`Removes the account with its ${counts.balances} saved balance${counts.balances === 1 ? "" : "s"}${counts.flows ? ` and ${counts.flows} contribution${counts.flows === 1 ? "" : "s"}` : ""} from your net worth. Your data repo's git history keeps the old version if you ever need it back.`}
                confirmLabel="Delete"
                destructive
                onConfirm={() => onDelete(account)}
              />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button disabled={busy || !(amount >= 0) || value === ""}>Save</Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
