import { useRef, useState } from "react";
import { FileUpIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ViewProps } from "@/App";
import { DocumentReader, type DocExtraction } from "@/lib/ai/documents";
import { applyDocument, knownPasswords, loadDocument, NeedsPasswordError, type DocumentChange } from "@/lib/documents";
import { loadSettings, resolveGeminiKey } from "@/lib/settings";
import type { DocKind } from "@/types";

type Step =
  | { kind: "idle" }
  | { kind: "reading"; file: File }
  | { kind: "password"; file: File; wrong?: boolean }
  | { kind: "review"; file: File; x: DocExtraction; change: DocumentChange; password?: string };

const KIND_LABEL: Record<string, string> = {
  epf_passbook: "EPF passbook",
  ppf_statement: "PPF statement",
  nps_statement: "NPS statement",
  fd_receipt: "Fixed deposit",
  demat_statement: "Demat statement",
  loan_statement: "Loan statement",
  payslip: "Payslip",
  form16: "Form 16",
  insurance_policy: "Insurance policy",
};

/** "Import document" button + the unlock → read → confirm flow. */
export default function ImportDocument({ store, data, reload, label = "Import document" }: ViewProps & { label?: string }) {
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const read = async (file: File, typed?: string) => {
    setStep({ kind: "reading", file });
    try {
      const settings = loadSettings()!;
      const geminiKey = resolveGeminiKey(settings, data.config);
      if (!geminiKey) throw new Error("No Gemini key on this device: add it under Settings → Other devices");
      const { input, password: used } = await loadDocument(file, typed ? [typed] : knownPasswords(data.config));
      const x = await new DocumentReader(geminiKey, settings.geminiModel || undefined).read(input, file.name);
      const change = applyDocument(x, data, { kind: "upload", fileName: file.name }, new Date().toISOString().slice(0, 10));
      setStep({ kind: "review", file, x, change, password: typed ?? used });
    } catch (e) {
      if (e instanceof NeedsPasswordError) setStep({ kind: "password", file, wrong: !!typed });
      else {
        toast.error(`Couldn't import ${file.name}`, { description: (e as Error).message });
        setStep({ kind: "idle" });
      }
    }
  };

  const save = async () => {
    if (step.kind !== "review") return;
    setSaving(true);
    try {
      const files = { ...step.change.files };
      // Remember a typed password for this kind of document, so email syncs and future uploads open it.
      if (step.password && remember && !knownPasswords(data.config).includes(step.password)) {
        files["config.json"] = { ...data.config, passwords: { ...data.config.passwords, [step.x.kind as DocKind]: step.password } };
      }
      await store.writeJSON(files, `Import ${KIND_LABEL[step.x.kind] ?? "document"}: ${step.file.name}`);
      await reload();
      toast.success(step.change.description);
      setStep({ kind: "idle" });
    } catch (e) {
      toast.error("Couldn't save", { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const close = () => {
    setStep({ kind: "idle" });
    setPassword("");
  };

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,image/*,.xlsx,.csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) read(f);
          e.target.value = "";
        }}
      />
      <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={step.kind === "reading"}>
        {step.kind === "reading" ? <Loader2Icon className="animate-spin" /> : <FileUpIcon />}
        {step.kind === "reading" ? "Reading…" : label}
      </Button>

      <Dialog open={step.kind === "password" || step.kind === "review"} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          {step.kind === "password" && (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                read(step.file, password);
              }}
            >
              <DialogHeader>
                <DialogTitle>Password needed</DialogTitle>
                <DialogDescription>
                  {step.wrong ? "That password didn't open it. " : ""}
                  {step.file.name} is locked. Common ones: PAN in capitals, date of birth (DDMMYYYY), PRAN or UAN; the email it came with usually says.
                </DialogDescription>
              </DialogHeader>
              <Input autoFocus type="password" className="font-mono" value={password} onChange={(e) => setPassword(e.target.value)} />
              <DialogFooter>
                <Button disabled={!password}>Unlock</Button>
              </DialogFooter>
            </form>
          )}
          {step.kind === "review" && (
            <div className="space-y-4">
              <DialogHeader>
                <DialogTitle>{KIND_LABEL[step.x.kind] ?? "Document"}</DialogTitle>
                <DialogDescription>{step.x.summary}</DialogDescription>
              </DialogHeader>
              <p className="rounded-md bg-muted px-3 py-2 text-sm">{step.change.description}</p>
              {step.password && !knownPasswords(data.config).includes(step.password) && (
                <div className="flex items-center gap-2">
                  <Checkbox id="remember" checked={remember} onCheckedChange={(v) => setRemember(v === true)} />
                  <Label htmlFor="remember" className="text-sm font-normal">
                    Remember this password for {KIND_LABEL[step.x.kind]?.toLowerCase() ?? "these documents"} (saved in your repo's config)
                  </Label>
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={close}>
                  Cancel
                </Button>
                <Button onClick={save} disabled={saving}>
                  {saving && <Loader2Icon className="animate-spin" />}
                  Save
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
