import { useState } from "react";
import type { ViewProps } from "@/App";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import MutualFunds from "./MutualFunds";

const TABS = [
  { value: "holdings", label: "Holdings" },
  { value: "performance", label: "Performance" },
  { value: "analysis", label: "Analysis" },
  { value: "goals", label: "Goals & rebalance" },
] as const;
type Value = (typeof TABS)[number]["value"];

const KEY = "leaf.fundsTab";

/** Mutual funds: what you hold, how it has done, what's inside it, and where you're headed. */
export default function Funds(props: ViewProps) {
  const [tab, setTab] = useState<Value>(() => {
    try {
      const saved = localStorage.getItem(KEY);
      return TABS.some((t) => t.value === saved) ? (saved as Value) : "holdings";
    } catch {
      return "holdings";
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
      <TabsContent value="holdings">
        <MutualFunds {...props} section="holdings" />
      </TabsContent>
      <TabsContent value="performance">
        <MutualFunds {...props} section="performance" />
      </TabsContent>
      <TabsContent value="analysis">
        <MutualFunds {...props} section="insights" />
      </TabsContent>
      <TabsContent value="goals">
        <MutualFunds {...props} section="plan" />
      </TabsContent>
    </Tabs>
  );
}
