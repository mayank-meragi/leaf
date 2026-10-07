import { useState } from "react";
import { MailPlusIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ViewProps } from "@/App";
import { DEFAULT_MODEL } from "@/lib/ai/extract";
import { connectAccount, googleConfigured, needsSignIn, setGoogleClientId, signIn } from "@/lib/google/auth";
import { clearSettings, saveSettings, type Settings } from "@/lib/settings";
import { useSaveConfig } from "@/lib/useConfig";
import type { DocKind, LeafConfig } from "@/types";
import ConfirmDialog from "./ConfirmDialog";
import ExportCard from "./ExportCard";
import FindSenders from "./FindSenders";
import SectionCard from "./SectionCard";

interface Props extends ViewProps {
  settings: Settings;
  onSettings: (s: Settings) => void;
  onSignOut: () => void;
}

/** Set once, rarely touched: grouped by what you're doing, not by where the value is stored. */
export default function SettingsView({ store, data, setData, settings, onSettings, onSignOut }: Props) {
  const { busy, saveConfig } = useSaveConfig({ store, data, setData });
  // Re-render after a sign-in (token state lives outside React).
  const [, setTick] = useState(0);
  const { config } = data;

  const addAccount = async () => {
    try {
      const email = await connectAccount();
      if (config.accounts.some((a) => a.email === email)) return toast.info(`${email} is already connected.`);
      if (await saveConfig({ ...config, accounts: [...config.accounts, { email }] }, `Connect ${email}`)) toast.success(`Connected ${email}`);
    } catch (e) {
      toast.error("Couldn't connect Gmail", { description: (e as Error).message });
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <Group title="Connections" hint="Where Leaf reads your money from.">
        <SectionCard title="Gmail accounts" description="Leaf reads these read-only for bank alerts and CAS statements." bodyClassName="space-y-4">
          {!googleConfigured() && (
            <p className="rounded-md bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
              Add your Google OAuth client ID under <b>Google sign-in</b> below.
            </p>
          )}
          {config.accounts.length > 0 && (
            <ul className="divide-y">
              {config.accounts.map((a) => (
                <li key={a.email} className="flex items-center gap-3 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{a.email}</div>
                    <div className="text-xs text-muted-foreground">
                      {a.syncedUntil ? `Synced up to ${new Date(a.syncedUntil * 1000).toLocaleString("en-IN")}` : "Not synced yet"}
                      {" · "}
                      {needsSignIn([a.email], 0).length ? <span className="text-amber-700 dark:text-amber-400">sign-in expired</span> : "signed in"}
                    </div>
                  </div>
                  {needsSignIn([a.email], 0).length ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        try {
                          await signIn(a.email);
                          setTick((n) => n + 1);
                        } catch (e) {
                          toast.error(`Couldn't sign in to ${a.email}`, { description: (e as Error).message });
                        }
                      }}
                    >
                      Sign in
                    </Button>
                  ) : (
                    <FindSenders account={a.email} config={config} disabled={busy} onSave={(next) => saveConfig(next, "Add alert senders")} />
                  )}
                  <ConfirmDialog
                    trigger={
                      <Button variant="ghost" size="sm" disabled={busy}>
                        Remove
                      </Button>
                    }
                    title={`Disconnect ${a.email}?`}
                    description="Leaf stops syncing this inbox. Transactions already imported stay in your repo."
                    confirmLabel="Disconnect"
                    destructive
                    onConfirm={() => saveConfig({ ...config, accounts: config.accounts.filter((x) => x.email !== a.email) }, `Disconnect ${a.email}`)}
                  />
                </li>
              ))}
            </ul>
          )}
          {config.extraSenders?.length ? (
            <div className="space-y-1.5">
              <Label>Extra senders</Label>
              <div className="flex flex-wrap gap-1.5">
                {config.extraSenders.map((x) => (
                  <Badge key={x.sender} variant="secondary" className="gap-1 pr-1">
                    {x.sender}
                    <button
                      aria-label={`Remove ${x.sender}`}
                      disabled={busy}
                      className="rounded-sm p-0.5 hover:bg-foreground/10"
                      onClick={() => saveConfig({ ...config, extraSenders: config.extraSenders!.filter((y) => y.sender !== x.sender) }, `Remove sender ${x.sender}`)}
                    >
                      <XIcon className="size-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}
          <Button onClick={addAccount} disabled={busy || !googleConfigured()}>
            <MailPlusIcon /> Connect Gmail account
          </Button>
        </SectionCard>
        <GoogleSignIn config={config} busy={busy} onSaveConfig={saveConfig} />
        <OpenAI config={config} settings={settings} busy={busy} onSaveConfig={saveConfig} onSettings={onSettings} />
      </Group>

      <Group title="Passwords" hint="For locked statements from email and uploads.">
        <Passwords config={config} busy={busy} onSave={(next) => saveConfig(next, "Update document passwords")} />
      </Group>

      <Group title="Data" hint="Your data lives in your private GitHub repo.">
        <ExportCard data={data} store={store} />
      </Group>

      <Group title="This device">
        <SectionCard
          title="Repository"
          description={
            <>
              Data repo <code>{settings.owner}/{settings.repo}</code> on <code>{settings.branch}</code>.
            </>
          }
        >
          <ConfirmDialog
            trigger={
              <Button variant="outline" className="text-destructive hover:text-destructive">
                Sign out of this device
              </Button>
            }
            title="Sign out of this device?"
            description="Leaf forgets the GitHub token and OpenAI key in this browser. Your data in the repo is untouched."
            confirmLabel="Sign out"
            destructive
            onConfirm={() => {
              clearSettings();
              onSignOut();
            }}
          />
        </SectionCard>
      </Group>
    </div>
  );
}

function Group({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

const PASSWORD_KINDS: { kind: DocKind; label: string; hint: string }[] = [
  { kind: "nps_statement", label: "NPS statements", hint: "Protean's monthly statement PDF" },
  { kind: "payslip", label: "Payslips", hint: "Often PAN, or date of birth" },
  { kind: "form16", label: "Form 16", hint: "Usually PAN in capitals" },
  { kind: "epf_passbook", label: "EPF passbook", hint: "Usually not locked" },
  { kind: "loan_statement", label: "Loan statements", hint: "Varies by lender" },
];

/** The CAS password plus one per document type, saved together. Leaf tries all of them on any locked file. */
function Passwords({ config, busy, onSave }: { config: LeafConfig; busy: boolean; onSave: (c: LeafConfig) => Promise<unknown> }) {
  const [cas, setCas] = useState(config.casPassword ?? "");
  const [draft, setDraft] = useState<Partial<Record<DocKind, string>>>(config.passwords ?? {});
  const changed =
    cas !== (config.casPassword ?? "") || PASSWORD_KINDS.some(({ kind }) => (draft[kind] ?? "") !== (config.passwords?.[kind] ?? ""));
  return (
    <SectionCard
      title="Document passwords"
      description={
        <>
          Saved in <code>config.json</code> in your private repo. CAMS and KFintech lock statements with your PAN in capitals.
        </>
      }
      bodyClassName="space-y-3"
    >
      <Row id="pw-cas" label="Mutual fund CAS" hint="PAN in capitals" value={cas} onChange={(v) => setCas(v.trim())} />
      {PASSWORD_KINDS.map(({ kind, label, hint }) => (
        <Row key={kind} id={`pw-${kind}`} label={label} hint={hint} value={draft[kind] ?? ""} onChange={(v) => setDraft({ ...draft, [kind]: v })} />
      ))}
      <Button
        disabled={busy || !changed}
        onClick={async () => {
          const passwords = Object.fromEntries(Object.entries(draft).filter(([, v]) => v?.trim())) as LeafConfig["passwords"];
          if (await onSave({ ...config, casPassword: cas || undefined, passwords })) toast.success("Passwords saved. Sync to retry locked statements.");
        }}
      >
        Save
      </Button>
    </SectionCard>
  );
}

function Row({ id, label, hint, value, onChange }: { id: string; label: string; hint: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] items-center gap-3">
      <Label htmlFor={id} className="text-sm font-normal">
        {label}
      </Label>
      <Input id={id} type="password" className="h-8 font-mono" placeholder={hint} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

interface ConfigProps {
  config: LeafConfig;
  busy: boolean;
  onSaveConfig: (c: LeafConfig, message: string) => Promise<boolean>;
}

/** The OAuth client ID Leaf signs in to Gmail with. Kept in the repo so other devices pick it up. */
function GoogleSignIn({ config, busy, onSaveConfig }: ConfigProps) {
  const [clientId, setClientId] = useState(config.googleClientId ?? "");
  return (
    <SectionCard title="Google sign-in" description="The OAuth client ID Leaf uses to read your Gmail. Not a secret; other devices pick it up from your repo.">
      <div className="space-y-1.5">
        <Label htmlFor="client-id">Google OAuth client ID</Label>
        <div className="flex gap-2">
          <Input id="client-id" className="font-mono text-xs" placeholder="…apps.googleusercontent.com" value={clientId} onChange={(e) => setClientId(e.target.value.trim())} />
          <Button
            disabled={busy || !clientId || clientId === config.googleClientId}
            onClick={async () => {
              if (await onSaveConfig({ ...config, googleClientId: clientId }, "Update Google client ID")) {
                setGoogleClientId(clientId);
                toast.success("Client ID saved to your repo");
              }
            }}
          >
            Save
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Each address you open Leaf from must be listed under <i>Authorized JavaScript origins</i> in that OAuth client; this one is{" "}
          <code>{window.location.origin}</code>.
        </p>
      </div>
    </SectionCard>
  );
}

/** The model and API key that read your emails and documents. The key can stay on this device or live in the repo for others. */
function OpenAI({ config, settings, busy, onSaveConfig, onSettings }: ConfigProps & { settings: Settings; onSettings: (s: Settings) => void }) {
  const [model, setModel] = useState(settings.openaiModel ?? "");
  const [deviceKey, setDeviceKey] = useState("");
  const keySource = settings.openaiKey ? "device" : config.openaiKey ? "repo" : "none";

  return (
    <SectionCard title="OpenAI" description="Reads your bank alerts and imported documents." bodyClassName="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="model">Model</Label>
        <div className="flex gap-2">
          <Input id="model" className="font-mono" value={model} placeholder={DEFAULT_MODEL} onChange={(e) => setModel(e.target.value.trim())} />
          <Button
            disabled={model === (settings.openaiModel ?? "")}
            onClick={() => {
              const next = { ...settings, openaiModel: model || undefined };
              saveSettings(next);
              onSettings(next);
              toast.success("Model saved");
            }}
          >
            Save
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <Label>API key</Label>
        <p className="text-sm text-muted-foreground">
          {keySource === "device" && (config.openaiKey ? "This device has its own key; a copy is also in your repo." : "Only on this device.")}
          {keySource === "repo" && "Using the copy saved in your repo."}
          {keySource === "none" && "No key on this device or in your repo: syncing and document import need one."}
        </p>
        <div className="flex flex-wrap gap-2">
          {settings.openaiKey && settings.openaiKey !== config.openaiKey && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={async () => {
                if (await onSaveConfig({ ...config, openaiKey: settings.openaiKey }, "Store OpenAI key for other devices"))
                  toast.success("OpenAI key saved to your repo; other devices can now sync");
              }}
            >
              Save this device's key to repo
            </Button>
          )}
          {config.openaiKey && (
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              disabled={busy}
              onClick={async () => {
                const { openaiKey: _removed, ...rest } = config;
                if (await onSaveConfig(rest as LeafConfig, "Remove OpenAI key from repo")) toast.success("Removed from your repo (git history still has it; rotate the key if that matters)");
              }}
            >
              Remove from repo
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Input type="password" className="font-mono" placeholder="Set a key for this device only" value={deviceKey} onChange={(e) => setDeviceKey(e.target.value.trim())} />
          <Button
            variant="outline"
            disabled={!deviceKey}
            onClick={() => {
              const next = { ...settings, openaiKey: deviceKey };
              saveSettings(next);
              onSettings(next);
              setDeviceKey("");
              toast.success("Saved on this device");
            }}
          >
            Save
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">The repo copy sits in plain text in your private repo, readable by anyone with access to it.</p>
      </div>
    </SectionCard>
  );
}
