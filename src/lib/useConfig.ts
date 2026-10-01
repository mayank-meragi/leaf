import { useState } from "react";
import { toast } from "sonner";
import type { ViewProps } from "@/App";
import type { LeafConfig } from "@/types";

/** Saves `config.json` to the repo and updates local data. `busy` is true while a save is in flight. */
export function useSaveConfig({ store, data, setData }: Pick<ViewProps, "store" | "data" | "setData">) {
  const [busy, setBusy] = useState(false);
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
  return { busy, saveConfig };
}
