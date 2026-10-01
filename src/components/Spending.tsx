import { useState } from "react";
import type { ViewProps } from "@/App";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import CardsAccounts from "./CardsAccounts";
import Categories from "./Categories";
import Transactions from "./Transactions";

const TABS = [
  { value: "transactions", label: "Transactions" },
  { value: "categories", label: "Categories" },
  { value: "cards", label: "Cards & accounts" },
] as const;
type Value = (typeof TABS)[number]["value"];

const KEY = "leaf.spendingTab";

interface Props extends ViewProps {
  /** A card or account to show the transactions of. */
  initialSource?: string | null;
  /** A tab to land on, e.g. from a link on Home. */
  initialTab?: string | null;
}

/** Where the money goes: every transaction, how it's categorised, and the cards and accounts it flows through. */
export default function Spending({ initialSource, initialTab, ...props }: Props) {
  const [source, setSource] = useState<string | null>(initialSource ?? null);
  const [tab, setTab] = useState<Value>(() => {
    if (initialSource) return "transactions";
    try {
      const wanted = initialTab ?? localStorage.getItem(KEY);
      return TABS.some((t) => t.value === wanted) ? (wanted as Value) : "transactions";
    } catch {
      return "transactions";
    }
  });
  const change = (v: string) => {
    setTab(v as Value);
    try {
      localStorage.setItem(KEY, v);
    } catch {}
  };

  return (
    <Tabs value={tab} onValueChange={change} className="gap-4">
      <TabsList className="max-w-full justify-start overflow-x-auto">
        {TABS.map((t) => (
          <TabsTrigger key={t.value} value={t.value}>
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="transactions">
        <Transactions key={source ?? "all"} {...props} initialSource={source} />
      </TabsContent>
      <TabsContent value="categories">
        <Categories {...props} />
      </TabsContent>
      <TabsContent value="cards">
        <CardsAccounts
          {...props}
          onOpenSource={(key) => {
            setSource(key);
            setTab("transactions");
          }}
        />
      </TabsContent>
    </Tabs>
  );
}
