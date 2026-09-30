import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2Icon, RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { DocumentReader } from "./lib/ai/documents";
import { Extractor } from "./lib/ai/extract";
import { allCategories } from "./lib/categories";
import { loadAll, storeFor, type LeafData } from "./lib/db";
import type { GitHubStore } from "./lib/github/store";
import { clearSettings, loadSettings, resolveGeminiKey, type Settings } from "./lib/settings";
import { sync, type SyncProgress } from "./lib/sync";
import { cn } from "./lib/utils";
import Setup from "./components/Setup";
import Overview from "./components/Overview";
import Transactions from "./components/Transactions";
import Investments from "./components/Investments";
import SettingsView from "./components/SettingsView";
import SignInGate from "./components/SignInGate";
import { ENV_CLIENT_ID, needsSignIn, setGoogleClientId } from "./lib/google/auth";
import NetWorth from "./components/NetWorth";
import IncomeTax from "./components/IncomeTax";

const TABS = ["Overview", "Transactions", "Investments", "Net worth", "Income & tax", "Settings"] as const;
export type Tab = (typeof TABS)[number];

/** What every data view gets: the store, current data, and ways to refresh it. */
export interface ViewProps {
  store: GitHubStore;
  data: LeafData;
  /** Refetch from GitHub. */
  reload: () => Promise<void>;
  /** Replace local data after a successful commit, without a round trip. */
  setData: (data: LeafData) => void;
}

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(loadSettings);
  return (
    <>
      {settings ? (
        <Leaf settings={settings} onSignOut={() => setSettings(null)} onSettings={setSettings} />
      ) : (
        <Setup onDone={setSettings} />
      )}
      <Toaster richColors position="bottom-right" />
    </>
  );
}

function Leaf({ settings, onSignOut, onSettings }: { settings: Settings; onSignOut: () => void; onSettings: (s: Settings) => void }) {
  const store = useMemo(() => storeFor(settings), [settings]);
  const [data, setData] = useState<LeafData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("Overview");
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [signInFor, setSignInFor] = useState<string[] | null>(null);
  // Set when another view sends the user to Transactions filtered to one card/account.
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  const openSource = (key: string) => {
    setSourceFilter(key);
    setTab("Transactions");
  };

  const reload = useCallback(async () => {
    setLoadError(null);
    try {
      let loaded = await loadAll(store);
      // One-time move: the client ID used to live in .env.local; put it in the repo so other devices get it.
      if (!loaded.config.googleClientId && ENV_CLIENT_ID) {
        const config = { ...loaded.config, googleClientId: ENV_CLIENT_ID };
        await store.writeJSON({ "config.json": config }, "Store Google client ID in config");
        loaded = { ...loaded, config };
      }
      setGoogleClientId(loaded.config.googleClientId);
      setData(loaded);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [store]);

  useEffect(() => {
    reload();
  }, [reload]);

  const runSync = async () => {
    if (!data) return;
    const geminiKey = resolveGeminiKey(settings, data.config);
    if (!geminiKey) {
      toast.error("No Gemini key on this device", { description: "Add it under Settings → Other devices, or save it to your repo from a device that has it." });
      return;
    }
    try {
      const extractor = new Extractor(geminiKey, allCategories(data.config), settings.geminiModel || undefined);
      const reader = new DocumentReader(geminiKey, settings.geminiModel || undefined);
      const result = await sync(store, data, extractor, reader, setProgress);
      const summary = [
        `${result.transactions} new transactions`,
        result.updated && `${result.updated} updated`,
        result.cardStatements && `${result.cardStatements} card bills`,
        result.cardPayments && `${result.cardPayments} card payments`,
        result.wealth && `${result.wealth} NPS updates`,
        result.payroll && `${result.payroll} payslips / Form 16`,
        result.statements && `${result.statements} CAS`,
      ]
        .filter(Boolean)
        .join(", ");
      if (result.warnings.length) {
        toast.warning(`Synced with warnings: ${summary}`, {
          description: result.warnings.join("\n"),
          duration: Infinity,
          closeButton: true,
        });
      } else toast.success(`Synced: ${summary}`);
      await reload();
    } catch (e) {
      toast.error("Sync failed", { description: (e as Error).message, duration: Infinity, closeButton: true });
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="mx-auto min-h-screen max-w-6xl px-4 pb-16">
      {signInFor && data && (
        <SignInGate pending={signInFor} total={data.config.accounts.length} onSync={runSync} onClose={() => setSignInFor(null)} />
      )}
      <header className="flex flex-wrap items-center gap-3 py-5">
        <div className="flex items-center gap-2">
          <img src="leaf.svg" alt="" className="size-7" />
          <span className="text-xl font-semibold tracking-tight">Leaf</span>
        </div>
        <nav className="order-last flex w-full gap-1 overflow-x-auto sm:order-none sm:ml-6 sm:w-auto">
          {TABS.map((t) => (
            <Button
              key={t}
              variant={tab === t ? "secondary" : "ghost"}
              size="sm"
              onClick={() => {
                setSourceFilter(null);
                setTab(t);
              }}
              className={cn(tab === t && "font-semibold")}
            >
              {t}
            </Button>
          ))}
        </nav>
        <div className="ml-auto flex min-w-0 items-center gap-3">
          {progress && (
            <span className="hidden max-w-xs truncate text-xs text-muted-foreground sm:inline">
              {progress.account && <b className="font-medium">{progress.account}: </b>}
              {progress.message}
            </span>
          )}
          <Button
            onClick={() => {
              const pending = needsSignIn(data!.config.accounts.map((a) => a.email));
              if (pending.length) setSignInFor(pending);
              else runSync();
            }}
            disabled={!data || !!progress || !data.config.accounts.length}
            title={data && !data.config.accounts.length ? "Connect a Gmail account in Settings first" : undefined}
          >
            {progress ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
            {progress ? "Syncing…" : "Sync"}
          </Button>
        </div>
      </header>

      {loadError && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <span className="flex-1">Couldn't load from GitHub: {loadError}</span>
          <Button variant="outline" size="sm" onClick={reload}>
            Retry
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              clearSettings();
              onSignOut();
            }}
          >
            Change connection
          </Button>
        </div>
      )}

      {!data ? (
        !loadError && (
          <p className="flex items-center justify-center gap-2 py-20 text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" /> Loading from GitHub…
          </p>
        )
      ) : tab === "Overview" ? (
        <Overview data={data} onNavigate={setTab} onOpenSource={openSource} />
      ) : tab === "Transactions" ? (
        <Transactions key={sourceFilter ?? "all"} store={store} data={data} reload={reload} setData={setData} initialSource={sourceFilter} />
      ) : tab === "Investments" ? (
        <Investments store={store} data={data} reload={reload} setData={setData} />
      ) : tab === "Net worth" ? (
        <NetWorth store={store} data={data} reload={reload} setData={setData} />
      ) : tab === "Income & tax" ? (
        <IncomeTax store={store} data={data} reload={reload} setData={setData} />
      ) : (
        <SettingsView store={store} data={data} reload={reload} setData={setData} settings={settings} onSettings={onSettings} onSignOut={onSignOut} />
      )}
    </div>
  );
}
