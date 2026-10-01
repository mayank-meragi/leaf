import { useEffect, useMemo, useState } from "react";
import { CopyIcon, DownloadIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { bundleText, buildExport, estimateTokens, loadExportExtras, zipFiles, type ExportExtras } from "@/lib/export";
import type { GitHubStore } from "@/lib/github/store";
import type { LeafData } from "@/lib/db";
import SectionCard from "./SectionCard";

const RANGES = [
  { value: "3", label: "Last 3 months" },
  { value: "6", label: "Last 6 months" },
  { value: "12", label: "Last 12 months" },
  { value: "all", label: "All time" },
];

const save = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
};

export default function ExportCard({ data, store }: { data: LeafData; store: GitHubStore }) {
  const [range, setRange] = useState("12");
  const [redact, setRedact] = useState(true);
  // Fund portfolios and NAV history live in their own repo files; load them once for the fund analysis.
  const [extras, setExtras] = useState<ExportExtras | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    loadExportExtras(store, data).then((x) => live && setExtras(x), () => live && setExtras(null));
    return () => {
      live = false;
    };
  }, [store, data.config.benchmark]); // eslint-disable-line react-hooks/exhaustive-deps
  const today = new Date().toISOString().slice(0, 10);

  const files = useMemo(() => {
    const from = range === "all" ? undefined : new Date(new Date(`${today}T00:00:00Z`).setUTCMonth(new Date(`${today}T00:00:00Z`).getUTCMonth() - Number(range))).toISOString().slice(0, 10);
    return buildExport(data, { from, redact, today }, extras ?? undefined);
  }, [data, range, redact, today, extras]);
  const tokens = estimateTokens(files);

  return (
    <SectionCard
      title="Export for AI"
      description="Everything Leaf knows as CSV and JSON plus a README that explains the columns, ready to give to ChatGPT, Claude or Gemini for analysis."
      bodyClassName="space-y-4"
    >
      <div className="space-y-1.5">
        <Label>Transactions to include</Label>
        <Select value={range} onValueChange={setRange}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RANGES.map((r) => (
              <SelectItem key={r.value} value={r.value}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={redact} onChange={(e) => setRedact(e.target.checked)} />
        <span>
          Remove identifiers
          <span className="block text-xs text-muted-foreground">
            Drops folio numbers, account references and the insured name. Payee names in descriptions stay. Passwords and API keys are never exported.
          </span>
        </span>
      </label>
      <p className="text-xs text-muted-foreground">
        {extras === undefined ? "Loading fund portfolios… " : extras === null ? "Couldn't read fund portfolios, so fund analysis is left out. " : files.some((f) => f.name === "fund_overlap.csv") ? "" : "No fund portfolios synced yet, so overlap and look-through are left out (sync them in Mutual funds → Analysis). "}
        {files.length - 1} data files, about {tokens.toLocaleString("en-IN")} tokens{tokens > 150_000 && " (too big for most chats; pick a shorter range)"}.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => save(new Blob([zipFiles(files)], { type: "application/zip" }), `leaf-export-${today}.zip`)}>
          <DownloadIcon /> Download .zip
        </Button>
        <Button
          variant="outline"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(bundleText(files));
              toast.success("Copied. Paste it into your chat.");
            } catch {
              save(new Blob([bundleText(files)], { type: "text/plain" }), `leaf-export-${today}.txt`);
              toast.info("Couldn't copy, so downloaded a .txt instead.");
            }
          }}
        >
          <CopyIcon /> Copy as text
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Use the zip where the chat accepts file uploads; use the text where it only takes pasted text. Either way the data leaves your private repo, so use an assistant you trust.
      </p>
    </SectionCard>
  );
}
