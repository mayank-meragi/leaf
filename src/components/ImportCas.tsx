import { useImperativeHandle, useRef, useState, type Ref } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ViewProps } from "@/App";
import { statementPath } from "@/lib/db";
import { parseCAS } from "@/lib/parsers/cas/parse";
import { isCompleteStatement } from "@/lib/portfolio";
import type { Opener } from "./ImportDocument";

/** Mutual fund CAS upload (CAMS / KFintech PDF, MF Central XLSX): hidden file input + unlock dialog. */
export default function ImportCas({ store, data, reload, ref }: ViewProps & { ref?: Ref<Opener> }) {
  // A PDF waiting for a password the saved one didn't open.
  const [locked, setLocked] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => ({ open: () => fileRef.current?.click() }));

  const importFile = async (file: File, pw = data.config.casPassword) => {
    try {
      const stmt = /\.xlsx$/i.test(file.name) ? await fromXlsx(file) : await fromPdf(file, pw);
      if (!stmt) return; // waiting on a password
      if (!isCompleteStatement(stmt))
        throw new Error("This isn't a full consolidated statement (no statement period or folios). Upload a detailed CAS from CAMS, KFintech or MF Central.");
      await store.writeJSON({ [statementPath(stmt)]: stmt }, `Add CAS statement ${file.name}`);
      await reload();
      toast.success(`Imported ${stmt.folios.length} folios from ${file.name}`);
    } catch (e) {
      toast.error(`Couldn't import ${file.name}`, { description: (e as Error).message });
    }
  };

  const fromXlsx = async (file: File) => {
    const { isMFCentralWorkbook, parseMFCentral, readWorkbook } = await import("@/lib/parsers/cas/mfcentral");
    const sheets = await readWorkbook(file);
    if (!isMFCentralWorkbook(sheets)) throw new Error("Unrecognised spreadsheet. Upload the CAS detailed report from MF Central.");
    return parseMFCentral(sheets, { kind: "upload", fileName: file.name });
  };

  const fromPdf = async (file: File, pw: string | undefined) => {
    const { pdfToLines, WrongPasswordError } = await import("@/lib/parsers/cas/pdf");
    try {
      const lines = await pdfToLines(new Uint8Array(await file.arrayBuffer()), pw);
      return parseCAS(lines, { kind: "upload", fileName: file.name });
    } catch (e) {
      if (!(e instanceof WrongPasswordError)) throw e;
      if (pw !== data.config.casPassword) toast.error("That password didn't work.");
      setLocked(file);
      return null;
    }
  };

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) importFile(f);
          e.target.value = "";
        }}
      />
      <Dialog
        open={!!locked}
        onOpenChange={(open) => {
          if (!open) {
            setLocked(null);
            setPassword("");
          }
        }}
      >
        <DialogContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const file = locked!;
              setLocked(null);
              importFile(file, password);
              setPassword("");
            }}
          >
            <DialogHeader>
              <DialogTitle>Password needed</DialogTitle>
              <DialogDescription>
                {locked?.name} is locked. CAMS and KFintech use your PAN in capitals. Save it in Settings to skip this next time.
              </DialogDescription>
            </DialogHeader>
            <Input autoFocus type="password" className="font-mono" value={password} onChange={(e) => setPassword(e.target.value.trim())} />
            <DialogFooter>
              <Button disabled={!password}>Unlock</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
