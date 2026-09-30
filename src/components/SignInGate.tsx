import { useState } from "react";
import { CheckCircle2Icon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { signIn } from "@/lib/google/auth";

interface Props {
  /** Accounts that needed signing in when Sync was pressed. */
  pending: string[];
  total: number;
  onSync: () => void;
  onClose: () => void;
}

/**
 * Google sign-ins last an hour and can only be renewed from a click, so they're renewed here, before
 * the sync starts, one button per account.
 */
export default function SignInGate({ pending, total, onSync, onClose }: Props) {
  const [done, setDone] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const remaining = pending.filter((e) => !done.has(e));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sign in to sync every inbox</DialogTitle>
          <DialogDescription>
            Google sign-ins last an hour. {pending.length === 1 ? "This account needs" : "These accounts need"} a quick re-sign-in; accounts you skip are left
            out of this sync.
          </DialogDescription>
        </DialogHeader>
        <ul className="divide-y">
          {pending.map((email) => (
            <li key={email} className="flex items-center gap-3 py-2.5 text-sm">
              <span className="min-w-0 flex-1 truncate">{email}</span>
              {done.has(email) ? (
                <span className="flex items-center gap-1 text-positive">
                  <CheckCircle2Icon className="size-4" /> Signed in
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!!busy}
                  onClick={async () => {
                    setBusy(email);
                    try {
                      await signIn(email);
                      setDone((d) => new Set(d).add(email));
                    } catch (e) {
                      toast.error(`Couldn't sign in to ${email}`, { description: (e as Error).message });
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  {busy === email && <Loader2Icon className="animate-spin" />}
                  Sign in
                </Button>
              )}
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={total - remaining.length === 0}
            onClick={() => {
              onClose();
              onSync();
            }}
          >
            {total - remaining.length === 0 ? "Sign in to sync" : remaining.length ? `Sync ${total - remaining.length} of ${total} inboxes` : "Sync all inboxes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

