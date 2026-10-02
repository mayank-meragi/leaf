import { useImperativeHandle, useRef, useState, type Ref } from "react";
import { FileUpIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ViewProps } from "@/App";
import { StatementReader } from "@/lib/ai/bankStatement";
import { DocumentReader } from "@/lib/ai/documents";
import { PolicyReader } from "@/lib/ai/policy";
import { applyStatement } from "@/lib/bankStatement";
import { allCategories } from "@/lib/categories";
import { applyStockStatement, csvRows, parseHoldings } from "@/lib/stocks";
import { applyDocument, knownPasswords, loadDocument, NeedsPasswordError } from "@/lib/documents";
import { loadSettings, resolveGeminiKey } from "@/lib/settings";
import type { DocKind } from "@/types";

type Step =
  | { kind: "idle" }
  | { kind: "reading"; file: File }
  | { kind: "password"; file: File; wrong?: boolean }
  | { kind: "review"; file: File; review: Review; password?: string };

/** What the confirmation step shows and saves, whichever reader produced it. */
interface Review {
  docKind: DocKind;
  title: string;
  summary: string;
  description: string;
  files: Record<string, unknown>;
}

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
  bank_statement: "Bank statement",
  stock_holdings: "Stock holdings",
};

/** "Import document" button + the unlock → read → confirm flow. */
export interface Opener {
  open: () => void;
}

export default function ImportDocument({ store, data, reload, label, mode = "document", ref }: ViewProps & { label?: string; mode?: "document" | "statement" | "holdings"; ref?: Ref<Opener> }) {
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => ({ open: () => fileRef.current?.click() }));

  const read = async (file: File, typed?: string) => {
    setStep({ kind: "reading", file });
    try {
      const settings = loadSettings()!;
      const geminiKey = resolveGeminiKey(settings, data.config);
      if (!geminiKey) throw new Error("No Gemini key on this device: add it under Settings → Other devices");
      let review: Review;
      if (mode === "holdings") {
        // A broker's holdings file is a plain table: read it directly, no model involved.
        const sheets = /\.xlsx$/i.test(file.name)
          ? await (await import("@/lib/parsers/cas/mfcentral")).readWorkbook(file)
          : [{ rows: csvRows(await file.text()) }];
        const parsed = parseHoldings(sheets);
        const r = applyStockStatement(parsed, data, file.name, new Date().toISOString().slice(0, 10));
        setStep({ kind: "review", file, review: { docKind: "stock_holdings", title: KIND_LABEL.stock_holdings, summary: `${parsed.holdings.length} stocks${parsed.client ? ` · client ${parsed.client}` : ""}`, description: r.description, files: r.files } });
        return;
      }
      const { input, password: used } = await loadDocument(file, typed ? [typed] : knownPasswords(data.config));
      if (mode === "statement") {
        const reader = new StatementReader(geminiKey, allCategories(data.config), settings.geminiModel || undefined);
        const x = await reader.read(input, file.name, (i, n) => n > 1 && toast.info(`Reading ${file.name}: part ${i + 1} of ${n}…`, { id: "statement-progress" }));
        toast.dismiss("statement-progress");
        const r = applyStatement(x, data, file.name);
        review = { docKind: "bank_statement", title: KIND_LABEL.bank_statement, summary: `${x.bank} ${x.accountType === "credit_card" ? "credit card" : "account"} ••${x.accountLast4.slice(-4)}`, description: r.description, files: r.files };
      } else {
        const x = await new DocumentReader(geminiKey, settings.geminiModel || undefined).read(input, file.name);
        // A policy's conditions (room rent, co-pay, waiting periods…) are read in a second pass over the same document.
        const terms = x.kind === "insurance_policy" ? await new PolicyReader(geminiKey, settings.geminiModel || undefined).read(input, file.name).catch(() => undefined) : undefined;
        const change = applyDocument(x, data, { kind: "upload", fileName: file.name }, new Date().toISOString().slice(0, 10), terms);
        review = { docKind: x.kind as DocKind, title: KIND_LABEL[x.kind] ?? "Document", summary: x.summary, description: change.description, files: change.files };
      }
      setStep({ kind: "review", file, review, password: typed ?? used });
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
      const files = { ...step.review.files };
      // Remember a typed password for this kind of document, so email syncs and future uploads open it.
      if (step.password && remember && !knownPasswords(data.config).includes(step.password)) {
        files["config.json"] = { ...data.config, passwords: { ...data.config.passwords, [step.review.docKind]: step.password } };
      }
      await store.writeJSON(files, `Import ${step.review.title.toLowerCase()}: ${step.file.name}`);
      await reload();
      toast.success(step.review.description);
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
        accept={mode === "holdings" ? ".xlsx,.csv" : "application/pdf,image/*,.xlsx,.csv,.txt"}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) read(f);
          e.target.value = "";
        }}
      />
      {label && (
        <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={step.kind === "reading"}>
          {step.kind === "reading" ? <Loader2Icon className="animate-spin" /> : <FileUpIcon />}
          {step.kind === "reading" ? "Reading…" : label}
        </Button>
      )}

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
                <DialogTitle>{step.review.title}</DialogTitle>
                <DialogDescription>{step.review.summary}</DialogDescription>
              </DialogHeader>
              <p className="rounded-md bg-muted px-3 py-2 text-sm">{step.review.description}</p>
              {step.password && !knownPasswords(data.config).includes(step.password) && (
                <div className="flex items-center gap-2">
                  <Checkbox id="remember" checked={remember} onCheckedChange={(v) => setRemember(v === true)} />
                  <Label htmlFor="remember" className="text-sm font-normal">
                    Remember this password for {step.review.title.toLowerCase()}s (saved in your repo's config)
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
