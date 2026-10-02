import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LandmarkIcon,
  LayoutDashboardIcon,
  Loader2Icon,
  PanelLeftIcon,
  PiggyBankIcon,
  ReceiptIcon,
  ShieldIcon,
  RefreshCwIcon,
  SettingsIcon,
  CandlestickChartIcon,
  TrendingUpIcon,
  WalletIcon,
  type LucideIcon,
} from "lucide-react";
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
import Home from "./components/Home";
import Epf from "./components/Epf";
import Insurance from "./components/Insurance";
import Funds from "./components/Funds";
import Stocks from "./components/Stocks";
import NetWorth from "./components/NetWorth";
import Spending from "./components/Spending";
import SettingsView from "./components/SettingsView";
import SignInGate from "./components/SignInGate";
import { ENV_CLIENT_ID, needsSignIn, setGoogleClientId } from "./lib/google/auth";
import ImportMenu from "./components/ImportMenu";
import Tax from "./components/Tax";

import { TABS, type Tab } from "./lib/tabs";
export type { Tab };

const TAB_ICONS: Record<Tab, LucideIcon> = {
  Home: LayoutDashboardIcon,
  Spending: WalletIcon,
  "Net worth": LandmarkIcon,
  "Mutual funds": TrendingUpIcon,
  Stocks: CandlestickChartIcon,
  EPF: PiggyBankIcon,
  Insurance: ShieldIcon,
  "Tax & income": ReceiptIcon,
  Settings: SettingsIcon,
};
const PRIMARY_TABS = TABS.filter((t) => t !== "Settings");

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
  const [tab, setTab] = useState<Tab>("Home");
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("leaf.sidebar") === "collapsed");
  const toggleSidebar = () =>
    setCollapsed((c) => {
      localStorage.setItem("leaf.sidebar", c ? "expanded" : "collapsed");
      return !c;
    });
  const [signInFor, setSignInFor] = useState<string[] | null>(null);
  const [section, setSection] = useState<string | null>(null);

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

  const goTo = (t: Tab, to?: string) => {
    setSection(to ?? null);
    setTab(t);
  };
  const startSync = () => {
    const pending = needsSignIn(data!.config.accounts.map((a) => a.email));
    if (pending.length) setSignInFor(pending);
    else runSync();
  };

  return (
    <div className="flex min-h-screen">
      {signInFor && data && (
        <SignInGate pending={signInFor} total={data.config.accounts.length} onSync={runSync} onClose={() => setSignInFor(null)} />
      )}
      <aside
        className={cn(
          "sticky top-0 hidden h-screen shrink-0 flex-col border-r bg-sidebar p-2 transition-[width] duration-300 md:flex",
          collapsed ? "w-sidebar-collapsed" : "w-sidebar",
        )}
      >
        <div className={cn("flex items-center gap-2 px-2 pt-4 pb-6", collapsed && "justify-center px-0")}>
          <img src="leaf.svg" alt="" className="size-8 shrink-0" />
          {!collapsed && <span className="text-xl font-semibold tracking-tight">Leaf</span>}
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {PRIMARY_TABS.map((t) => (
            <SidebarItem key={t} tab={t} active={tab === t} collapsed={collapsed} onClick={() => goTo(t)} />
          ))}
        </nav>
        <div className="flex flex-col gap-1 border-t pt-2">
          <SidebarItem tab="Settings" active={tab === "Settings"} collapsed={collapsed} onClick={() => goTo("Settings")} />
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleSidebar}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn("text-muted-foreground", collapsed ? "self-center" : "self-end")}
          >
            <PanelLeftIcon />
          </Button>
        </div>
      </aside>

      <div className="min-w-0 flex-1 px-4 pb-16 md:px-8">
        <header className="flex flex-wrap items-center gap-3 py-5 md:py-8">
          <div className="flex items-center gap-2 md:hidden">
            <img src="leaf.svg" alt="" className="size-7" />
            <span className="text-xl font-semibold tracking-tight">Leaf</span>
          </div>
          <h1 className="hidden text-2xl font-semibold tracking-tight md:block">{tab}</h1>
          <div className="ml-auto flex min-w-0 items-center gap-3">
            {progress && (
              <span className="hidden max-w-xs truncate text-xs text-muted-foreground sm:inline">
                {progress.account && <b className="font-medium">{progress.account}: </b>}
                {progress.message}
              </span>
            )}
            {data && <ImportMenu store={store} data={data} reload={reload} setData={setData} />}
            <Button
              onClick={startSync}
              disabled={!data || !!progress || !data.config.accounts.length}
              title={data && !data.config.accounts.length ? "Connect a Gmail account in Settings first" : undefined}
            >
              {progress ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
              {progress ? "Syncing…" : "Sync"}
            </Button>
          </div>
          <nav className="order-last flex w-full gap-1 overflow-x-auto md:hidden">
            {TABS.map((t) => (
              <Button key={t} variant={tab === t ? "secondary" : "ghost"} size="sm" onClick={() => goTo(t)} className={cn(tab === t && "font-semibold")}>
                {t}
              </Button>
            ))}
          </nav>
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
      ) : tab === "Home" ? (
        <Home data={data} onNavigate={goTo} />
      ) : tab === "Spending" ? (
        <Spending store={store} data={data} reload={reload} setData={setData} initialTab={section} />
      ) : tab === "Net worth" ? (
        <NetWorth store={store} data={data} reload={reload} setData={setData} onOpenFunds={() => goTo("Mutual funds")} onOpenEpf={() => goTo("EPF")} onOpenStocks={() => goTo("Stocks")} />
      ) : tab === "Mutual funds" ? (
        <Funds store={store} data={data} reload={reload} setData={setData} />
      ) : tab === "Stocks" ? (
        <Stocks store={store} data={data} reload={reload} setData={setData} />
      ) : tab === "Insurance" ? (
        <Insurance store={store} data={data} reload={reload} setData={setData} />
      ) : tab === "EPF" ? (
        <Epf store={store} data={data} reload={reload} setData={setData} />
      ) : tab === "Tax & income" ? (
        <Tax store={store} data={data} reload={reload} setData={setData} />
      ) : (
        <SettingsView store={store} data={data} reload={reload} setData={setData} settings={settings} onSettings={onSettings} onSignOut={onSignOut} />
      )}
      </div>
    </div>
  );
}

function SidebarItem({ tab, active, collapsed, onClick }: { tab: Tab; active: boolean; collapsed: boolean; onClick: () => void }) {
  const Icon = TAB_ICONS[tab];
  return (
    <Button
      variant={active ? "secondary" : "ghost"}
      onClick={onClick}
      title={tab}
      aria-current={active ? "page" : undefined}
      className={cn("h-11 gap-3 rounded-md [&_svg]:size-5", collapsed ? "justify-center px-0" : "justify-start px-3", !active && "text-muted-foreground")}
    >
      <Icon />
      {!collapsed && <span className="text-sm font-medium">{tab}</span>}
    </Button>
  );
}
