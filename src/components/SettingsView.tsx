import { useMemo, useState } from "react";
import { MailPlusIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ViewProps } from "@/App";
import { DEFAULT_MODEL } from "@/lib/ai/extract";
import { connectAccount, googleConfigured, needsSignIn, setGoogleClientId, signIn } from "@/lib/google/auth";
import FindSenders from "./FindSenders";
import { clearSettings, saveSettings, type Settings } from "@/lib/settings";
import { instruments, KIND_LABEL, KIND_ORDER, withInstrumentMeta } from "@/lib/instruments";
import type { DocKind, InstrumentKind, LeafConfig } from "@/types";
import ConfirmDialog from "./ConfirmDialog";

interface Props extends ViewProps {
  settings: Settings;
  onSettings: (s: Settings) => void;
  onSignOut: () => void;
}

export default function SettingsView({ store, data, setData, settings, onSettings, onSignOut }: Props) {
  const [busy, setBusy] = useState(false);
  // Re-render after a sign-in (token state lives outside React).
  const [, setTick] = useState(0);
  const [casPassword, setCasPassword] = useState(data.config.casPassword ?? "");
  const [model, setModel] = useState(settings.geminiModel ?? "");
  const { config } = data;
  const sources = useMemo(() => instruments(data.transactions, config), [data.transactions, config]);

  const saveConfig = async (next: LeafConfig, message: string) => {
    setBusy(true);
    try {
      await store.writeJSON({ "config.json": next }, message);
      setData({ ...data, config: next });
      return true;
    } catch (e) {
      toast.error("Couldn't save settings", { description: (e as Error).message });
      return false;
    } finally {
      setBusy(false);
    }
  };

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
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Gmail accounts</CardTitle>
          <CardDescription>Leaf reads these read-only for bank alerts and CAS statements.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!googleConfigured() && (
            <p className="rounded-md bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
              Add your Google OAuth client ID under <b>Other devices</b> below.
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Categories</CardTitle>
          <CardDescription>
            Create categories from any transaction's category picker. Tagging a transaction also tags everything to or from the
            same person, past and future.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label>Your categories</Label>
            {config.categories?.length ? (
              <div className="flex flex-wrap gap-1.5">
                {config.categories.map((c) => (
                  <Badge key={c} variant="secondary" className="gap-1 pr-1">
                    {c}
                    <button
                      aria-label={`Delete ${c}`}
                      disabled={busy}
                      className="rounded-sm p-0.5 hover:bg-foreground/10"
                      onClick={() =>
                        saveConfig(
                          {
                            ...config,
                            categories: config.categories!.filter((x) => x !== c),
                            categoryRules: config.categoryRules?.filter((r) => r.category !== c),
                          },
                          `Delete category ${c}`,
                        )
                      }
                    >
                      <XIcon className="size-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">None yet. Type a new name in a transaction's category picker.</p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Rules</Label>
            {config.categoryRules?.length ? (
              <ul className="divide-y text-sm">
                {config.categoryRules.map((r) => (
                  <li key={`${r.direction}:${r.party}`} className="flex items-center gap-2 py-1.5">
                    <span className="min-w-0 flex-1 truncate">
                      <span className="text-muted-foreground">{r.direction === "debit" ? "Paid to" : "From"}</span> {r.party}
                    </span>
                    <Badge variant="outline">{r.category}</Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label="Delete rule"
                      disabled={busy}
                      onClick={() =>
                        saveConfig({ ...config, categoryRules: config.categoryRules!.filter((x) => x !== r) }, `Delete rule for ${r.party}`)
                      }
                    >
                      <XIcon className="size-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No rules yet.</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cards & accounts</CardTitle>
          <CardDescription>
            Found in your alerts. Leaf guesses the type from the wording; fix it here and give each a name you'll recognise.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sources.length ? (
            <ul className="divide-y">
              {sources.map((i) => (
                <li key={i.key} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="w-28 shrink-0 text-sm tabular-nums text-muted-foreground">
                    {i.issuerLabel} ••{i.last4}
                  </span>
                  <Input
                    className="h-8 min-w-32 flex-1"
                    placeholder={`${i.issuerLabel} ${KIND_LABEL[i.kind]}`}
                    defaultValue={i.nickname ?? ""}
                    disabled={busy}
                    onBlur={(e) => {
                      const name = e.target.value.trim();
                      if (name !== (i.nickname ?? "")) saveConfig(withInstrumentMeta(config, i.key, { name }), `Rename ${i.key}`);
                    }}
                    onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                  />
                  <Select
                    value={i.kind}
                    disabled={busy}
                    onValueChange={(kind) => saveConfig(withInstrumentMeta(config, i.key, { kind: kind as InstrumentKind }), `Set ${i.key} type`)}
                  >
                    <SelectTrigger size="sm" className="w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {KIND_ORDER.map((k) => (
                        <SelectItem key={k} value={k}>
                          {KIND_LABEL[k]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">None yet. They appear after a sync.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>CAS password</CardTitle>
          <CardDescription>
            CAMS and KFintech lock statements with your PAN in capitals. Saved in <code>config.json</code> in your private repo.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Input className="font-mono" type="password" value={casPassword} onChange={(e) => setCasPassword(e.target.value.trim())} />
          <Button
            disabled={busy || casPassword === (config.casPassword ?? "")}
            onClick={async () => {
              if (await saveConfig({ ...config, casPassword: casPassword || undefined }, "Update CAS password"))
                toast.success("CAS password saved. Sync to retry statements.");
            }}
          >
            Save
          </Button>
        </CardContent>
      </Card>

      <DocumentPasswords config={config} busy={busy} onSave={(next) => saveConfig(next, "Update document passwords")} />

      <OtherDevices config={config} settings={settings} busy={busy} onSaveConfig={saveConfig} onSettings={onSettings} />

      <Card>
        <CardHeader>
          <CardTitle>This device</CardTitle>
          <CardDescription>
            Data repo <code>{settings.owner}/{settings.repo}</code> on <code>{settings.branch}</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="model">Gemini model</Label>
            <div className="flex gap-2">
              <Input id="model" className="font-mono" value={model} placeholder={DEFAULT_MODEL} onChange={(e) => setModel(e.target.value.trim())} />
              <Button
                disabled={model === (settings.geminiModel ?? "")}
                onClick={() => {
                  const next = { ...settings, geminiModel: model || undefined };
                  saveSettings(next);
                  onSettings(next);
                  toast.success("Model saved");
                }}
              >
                Save
              </Button>
            </div>
          </div>
          <ConfirmDialog
            trigger={
              <Button variant="ghost" className="text-destructive hover:text-destructive">
                Sign out of this device
              </Button>
            }
            title="Sign out of this device?"
            description="Leaf forgets the GitHub token and Gemini key in this browser. Your data in the repo is untouched."
            confirmLabel="Sign out"
            destructive
            onConfirm={() => {
              clearSettings();
              onSignOut();
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}

const PASSWORD_KINDS: { kind: DocKind; label: string; hint: string }[] = [
  { kind: "nps_statement", label: "NPS statements", hint: "Protean's monthly statement PDF" },
  { kind: "payslip", label: "Payslips", hint: "Often PAN, or date of birth" },
  { kind: "form16", label: "Form 16", hint: "Usually PAN in capitals" },
  { kind: "epf_passbook", label: "EPF passbook", hint: "Usually not locked" },
  { kind: "loan_statement", label: "Loan statements", hint: "Varies by lender" },
];

function DocumentPasswords({ config, busy, onSave }: { config: LeafConfig; busy: boolean; onSave: (c: LeafConfig) => Promise<unknown> }) {
  const [draft, setDraft] = useState<Partial<Record<DocKind, string>>>(config.passwords ?? {});
  const changed = PASSWORD_KINDS.some(({ kind }) => (draft[kind] ?? "") !== (config.passwords?.[kind] ?? ""));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Document passwords</CardTitle>
        <CardDescription>
          For locked PDFs from email and uploads. Leaf tries all of these (and the CAS password) on any locked document.
          Saved in <code>config.json</code> in your private repo.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {PASSWORD_KINDS.map(({ kind, label, hint }) => (
          <div key={kind} className="grid grid-cols-[9rem_1fr] items-center gap-3">
            <Label htmlFor={`pw-${kind}`} className="text-sm font-normal">
              {label}
            </Label>
            <Input
              id={`pw-${kind}`}
              type="password"
              className="h-8 font-mono"
              placeholder={hint}
              value={draft[kind] ?? ""}
              onChange={(e) => setDraft({ ...draft, [kind]: e.target.value })}
            />
          </div>
        ))}
        <Button
          disabled={busy || !changed}
          onClick={async () => {
            const passwords = Object.fromEntries(Object.entries(draft).filter(([, v]) => v?.trim())) as LeafConfig["passwords"];
            if (await onSave({ ...config, passwords })) toast.success("Passwords saved. Sync to retry locked statements.");
          }}
        >
          Save
        </Button>
      </CardContent>
    </Card>
  );
}

/** Everything a second device (e.g. a phone) needs, kept in the data repo so it only needs the GitHub token. */
function OtherDevices({
  config,
  settings,
  busy,
  onSaveConfig,
  onSettings,
}: {
  config: LeafConfig;
  settings: Settings;
  busy: boolean;
  onSaveConfig: (c: LeafConfig, message: string) => Promise<boolean>;
  onSettings: (s: Settings) => void;
}) {
  const [clientId, setClientId] = useState(config.googleClientId ?? "");
  const [deviceKey, setDeviceKey] = useState("");
  const origin = window.location.origin;
  const keySource = settings.geminiKey ? "device" : config.geminiKey ? "repo" : "none";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Other devices</CardTitle>
        <CardDescription>
          Open Leaf anywhere (e.g. your phone), enter the repo and GitHub token, and the rest comes from <code>config.json</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
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
            Not a secret. Each address you open Leaf from must be listed under <i>Authorized JavaScript origins</i> in that OAuth client; this one is{" "}
            <code>{origin}</code>.
          </p>
        </div>

        <div className="space-y-2">
          <Label>Gemini API key</Label>
          <p className="text-sm text-muted-foreground">
            {keySource === "device" && (config.geminiKey ? "This device has its own key; a copy is also in your repo." : "Only on this device.")}
            {keySource === "repo" && "Using the copy saved in your repo."}
            {keySource === "none" && "No key on this device or in your repo: syncing and document import need one."}
          </p>
          <div className="flex flex-wrap gap-2">
            {settings.geminiKey && settings.geminiKey !== config.geminiKey && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  if (await onSaveConfig({ ...config, geminiKey: settings.geminiKey }, "Store Gemini key for other devices"))
                    toast.success("Gemini key saved to your repo; other devices can now sync");
                }}
              >
                Save this device's key to repo
              </Button>
            )}
            {config.geminiKey && (
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive"
                disabled={busy}
                onClick={async () => {
                  const { geminiKey: _removed, ...rest } = config;
                  if (await onSaveConfig(rest as LeafConfig, "Remove Gemini key from repo")) toast.success("Removed from your repo (git history still has it; rotate the key if that matters)");
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
                const next = { ...settings, geminiKey: deviceKey };
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
      </CardContent>
    </Card>
  );
}
