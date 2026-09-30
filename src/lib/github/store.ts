// A tiny JSON "database" on top of a private GitHub repo.
// Reads go through the Contents API; writes are batched into a single commit via the Git Data API
// so one sync = one commit, and history doubles as an audit log.

const API = "https://api.github.com";

export interface RepoRef {
  owner: string;
  repo: string;
  branch: string;
  token: string;
}

export class GitHubError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function b64encode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function b64decode(b64: string): string {
  const bin = atob(b64.replace(/\n/g, ""));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export class GitHubStore {
  constructor(private ref: RepoRef) {}

  private async gh<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      // GitHub marks responses cacheable for 60s; a read right after our own commit must not be stale.
      cache: "no-store",
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.ref.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new GitHubError(res.status, body.message ?? res.statusText);
    }
    return res.status === 204 ? (undefined as T) : res.json();
  }

  private get repoPath() {
    return `/repos/${this.ref.owner}/${this.ref.repo}`;
  }

  /** Verifies the token can see the repo and returns whether it has any commits. */
  async check(): Promise<{ empty: boolean }> {
    await this.gh(this.repoPath);
    try {
      await this.gh(`${this.repoPath}/git/ref/heads/${this.ref.branch}`);
      return { empty: false };
    } catch (e) {
      if (e instanceof GitHubError && (e.status === 404 || e.status === 409)) return { empty: true };
      throw e;
    }
  }

  async readText(path: string): Promise<string | null> {
    try {
      const file = await this.gh<{ content: string; encoding: string; sha: string }>(
        `${this.repoPath}/contents/${encodeURI(path)}?ref=${this.ref.branch}`,
      );
      // Files over 1MB come back with encoding "none"; fetch the blob instead.
      if (file.encoding === "none") {
        const blob = await this.gh<{ content: string }>(`${this.repoPath}/git/blobs/${file.sha}`);
        return b64decode(blob.content);
      }
      return b64decode(file.content);
    } catch (e) {
      if (e instanceof GitHubError && e.status === 404) return null;
      throw e;
    }
  }

  async readJSON<T>(path: string): Promise<T | null> {
    const text = await this.readText(path);
    return text == null ? null : (JSON.parse(text) as T);
  }

  /** Lists file names directly under a directory ([] if it doesn't exist). */
  async list(dir: string): Promise<string[]> {
    try {
      const entries = await this.gh<{ name: string; type: string }[]>(
        `${this.repoPath}/contents/${encodeURI(dir)}?ref=${this.ref.branch}`,
      );
      return entries.filter((e) => e.type === "file").map((e) => e.name);
    } catch (e) {
      if (e instanceof GitHubError && e.status === 404) return [];
      throw e;
    }
  }

  /**
   * Writes several files in one commit. `null` deletes a file.
   * Retries once on a fast-forward conflict (someone else pushed in between).
   */
  async commit(files: Record<string, string | null>, message: string, attempt = 0): Promise<void> {
    const { empty } = await this.check();
    if (empty) {
      // The Git Data API can't operate on an empty repo; seed it via the Contents API first.
      await this.gh(`${this.repoPath}/contents/README.md`, {
        method: "PUT",
        body: JSON.stringify({
          message: "Initialize Leaf data repo",
          content: b64encode("# Leaf data\n\nManaged by Leaf. Edit with care.\n"),
          branch: this.ref.branch,
        }),
      });
    }

    const ref = await this.gh<{ object: { sha: string } }>(`${this.repoPath}/git/ref/heads/${this.ref.branch}`);
    const parent = await this.gh<{ tree: { sha: string } }>(`${this.repoPath}/git/commits/${ref.object.sha}`);
    const tree = await this.gh<{ sha: string }>(`${this.repoPath}/git/trees`, {
      method: "POST",
      body: JSON.stringify({
        base_tree: parent.tree.sha,
        tree: Object.entries(files).map(([path, content]) =>
          content == null
            ? { path, mode: "100644", type: "blob", sha: null }
            : { path, mode: "100644", type: "blob", content },
        ),
      }),
    });
    const commit = await this.gh<{ sha: string }>(`${this.repoPath}/git/commits`, {
      method: "POST",
      body: JSON.stringify({ message, tree: tree.sha, parents: [ref.object.sha] }),
    });
    try {
      await this.gh(`${this.repoPath}/git/refs/heads/${this.ref.branch}`, {
        method: "PATCH",
        body: JSON.stringify({ sha: commit.sha, force: false }),
      });
    } catch (e) {
      if (e instanceof GitHubError && e.status === 422 && attempt < 1) return this.commit(files, message, attempt + 1);
      throw e;
    }
  }

  async writeJSON(files: Record<string, unknown>, message: string) {
    const serialized = Object.fromEntries(
      Object.entries(files).map(([p, v]) => [p, v == null ? null : JSON.stringify(v, null, 2) + "\n"]),
    );
    return this.commit(serialized, message);
  }
}
