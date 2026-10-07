// Device-local secrets. These never go into the data repo.

export interface Settings {
  githubToken: string;
  owner: string;
  repo: string;
  branch: string;
  /** Device copy; empty when the key is kept in the data repo instead (see `resolveOpenAIKey`). */
  openaiKey: string;
  openaiModel?: string;
}

const KEY = "leaf.settings";

/** This device's OpenAI key, else the copy saved in the repo config. */
export function resolveOpenAIKey(settings: Settings, config: { openaiKey?: string }): string {
  return settings.openaiKey || config.openaiKey || "";
}

export function loadSettings(): Settings | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null") as Settings | null;
    return s?.githubToken && s.owner && s.repo ? s : null;
  } catch {
    return null;
  }
}

export function saveSettings(s: Settings) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function clearSettings() {
  localStorage.removeItem(KEY);
}
