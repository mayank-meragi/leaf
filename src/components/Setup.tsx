import { useState } from "react";
import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { storeFor } from "@/lib/db";
import { saveSettings, type Settings } from "@/lib/settings";

const link = "font-medium text-primary underline underline-offset-4";

export default function Setup({ onDone }: { onDone: (s: Settings) => void }) {
  const [s, setS] = useState<Settings>({ githubToken: "", owner: "", repo: "leaf-data", branch: "main", openaiKey: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, [k]: e.target.value.trim() });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await storeFor(s).check();
      saveSettings(s);
      onDone(s);
    } catch (err) {
      setError(`Could not access ${s.owner}/${s.repo}: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <div className="mb-8 flex items-center gap-3">
        <img src="leaf.svg" alt="" className="size-10" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Leaf</h1>
          <p className="text-sm text-muted-foreground">Your money, stored in your own GitHub repo.</p>
        </div>
      </div>
      <Card>
        <form onSubmit={submit}>
          <CardHeader>
            <CardTitle>Data repository</CardTitle>
            <CardDescription>
              Create a <b>private</b> repo, then a{" "}
              <a className={link} href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">
                fine-grained token
              </a>{" "}
              with access to only that repo and <i>Contents: Read and write</i>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Owner" id="owner">
                <Input id="owner" value={s.owner} onChange={set("owner")} placeholder="your-github-username" required />
              </Field>
              <Field label="Repo" id="repo">
                <Input id="repo" value={s.repo} onChange={set("repo")} required />
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="GitHub token" id="token" className="col-span-2">
                <Input id="token" className="font-mono" type="password" value={s.githubToken} onChange={set("githubToken")} placeholder="github_pat_…" required />
              </Field>
              <Field label="Branch" id="branch">
                <Input id="branch" value={s.branch} onChange={set("branch")} required />
              </Field>
            </div>

            <Separator className="my-6" />

            <div className="space-y-1.5">
              <h3 className="leading-none font-semibold">OpenAI</h3>
              <p className="text-sm text-muted-foreground">
                Reads your bank alert emails. Get a key from{" "}
                <a className={link} href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
                  Google AI Studio
                </a>
                .
              </p>
            </div>
            <Field label="OpenAI API key" id="openai">
              <Input id="openai" className="font-mono" type="password" value={s.openaiKey} onChange={set("openaiKey")} placeholder="sk-… (optional on a second device)" />
            </Field>
            <p className="text-xs text-muted-foreground">
              Setting up another device? Just the repo and token are enough if you saved the OpenAI key to your repo (Settings → Other devices);
              the Google sign-in settings come from the repo automatically.
            </p>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button className="w-full" disabled={busy}>
              {busy && <Loader2Icon className="animate-spin" />}
              {busy ? "Connecting…" : "Continue"}
            </Button>
          </CardContent>
        </form>
      </Card>
    </div>
  );
}

function Field({ label, id, className, children }: { label: string; id: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
