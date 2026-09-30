// Browser-only Google OAuth using Google Identity Services' token model.
// No backend means no refresh tokens: each account gets a ~1h access token, re-requested on demand
// (silently when Google allows it, via `prompt: ""` + `login_hint`).

const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
// Comes from the data repo's config.json (so any device works); the build-time env var is a first-run fallback.
export const ENV_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) || undefined;
let clientId = ENV_CLIENT_ID;

export function setGoogleClientId(id: string | undefined) {
  clientId = id || ENV_CLIENT_ID;
}

interface Token {
  accessToken: string;
  expiresAt: number;
}

interface GisTokenResponse {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string;
            scope: string;
            login_hint?: string;
            prompt?: string;
            callback: (r: GisTokenResponse) => void;
            error_callback?: (e: { type: string; message?: string }) => void;
          }): { requestAccessToken(overrides?: { prompt?: string; login_hint?: string }): void };
        };
      };
    };
  }
}

// Tokens live in sessionStorage only: they die with the tab and never reach the data repo.
const STORAGE_KEY = "leaf.google.tokens";
// Read lazily so importing this module outside a browser (tests) doesn't touch sessionStorage.
let cache: Record<string, Token> | null = null;
const tokensStore = () => (cache ??= JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, Token>);
const persist = () => sessionStorage.setItem(STORAGE_KEY, JSON.stringify(tokensStore()));

export function googleConfigured() {
  return Boolean(clientId);
}

async function waitForGis() {
  for (let i = 0; i < 50 && !window.google?.accounts?.oauth2; i++) await new Promise((r) => setTimeout(r, 100));
  if (!window.google?.accounts?.oauth2) throw new Error("Google Identity Services failed to load");
  return window.google.accounts.oauth2;
}

/** Requests a token and stores it under the account's real email, which it returns. */
function requestToken(loginHint: string | undefined, prompt: string): Promise<{ email: string; token: string }> {
  const client_id = clientId;
  if (!client_id) throw new Error("Add your Google OAuth client ID in Settings");
  return waitForGis().then(
    (oauth2) =>
      new Promise((resolve, reject) => {
        const client = oauth2.initTokenClient({
          client_id,
          scope: SCOPE,
          login_hint: loginHint,
          prompt,
          callback: (r) => {
            if (r.error || !r.access_token) return reject(new Error(r.error_description ?? r.error ?? "No token"));
            // The consent screen lets users untick the Gmail checkbox and still "succeed".
            if (!r.scope?.split(" ").includes(SCOPE))
              return reject(new Error("Gmail access wasn't granted. Connect again and tick \"Read your email messages and settings\"."));
            // Key by the real email: login_hint isn't guaranteed to be honoured.
            const token = r.access_token;
            stash(token, r.expires_in ?? 3600).then((email) => resolve({ email, token }), reject);
          },
          error_callback: (e) => reject(new Error(e.message ?? e.type)),
        });
        client.requestAccessToken();
      }),
  );
}

async function stash(accessToken: string, expiresIn: number) {
  const email = await profileEmail(accessToken);
  tokensStore()[email] = { accessToken, expiresAt: Date.now() + (expiresIn - 60) * 1000 };
  persist();
  return email;
}

async function profileEmail(accessToken: string): Promise<string> {
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw await googleError(res, "Gmail profile");
  return ((await res.json()) as { emailAddress: string }).emailAddress.toLowerCase();
}

/** Interactive: lets the user pick any Google account and returns its email. */
export async function connectAccount(): Promise<string> {
  return (await requestToken(undefined, "select_account consent")).email;
}

export class SignInRequiredError extends Error {
  constructor(public email: string) {
    super(`Sign in to ${email} again to sync it (Google sign-ins last an hour)`);
  }
}

/**
 * A valid token for `email`, without ever opening a popup: browsers block popups that aren't a direct
 * result of a click, so a mid-sync prompt would silently fail. Use `signIn` from a click handler instead.
 */
export async function getToken(email: string): Promise<string> {
  const cached = tokensStore()[email.toLowerCase()];
  if (cached && cached.expiresAt > Date.now()) return cached.accessToken;
  throw new SignInRequiredError(email);
}

/** Interactive re-sign-in for one account. Call directly from a click (one popup per click). */
export async function signIn(email: string): Promise<void> {
  const key = email.toLowerCase();
  const { email: actual } = await requestToken(key, "");
  if (actual !== key) throw new Error(`Signed in as ${actual}, expected ${key}`);
}

/** Accounts whose token is missing or runs out within `minutes` (a sync can take a while). */
export function needsSignIn(emails: string[], minutes = 15): string[] {
  return emails.filter((e) => {
    const t = tokensStore()[e.toLowerCase()];
    return !t || t.expiresAt < Date.now() + minutes * 60_000;
  });
}

/** Turns a Google API error response into a readable message (reason + hint for the common ones). */
export async function googleError(res: Response, what: string): Promise<Error> {
  const body = await res.json().catch(() => null);
  const err = body?.error;
  const reason: string | undefined = err?.details?.find((d: { reason?: string }) => d.reason)?.reason ?? err?.errors?.[0]?.reason;
  const hints: Record<string, string> = {
    SERVICE_DISABLED: "Enable the Gmail API in the same Google Cloud project as your OAuth client, then wait a minute.",
    accessNotConfigured: "Enable the Gmail API in the same Google Cloud project as your OAuth client, then wait a minute.",
    ACCESS_TOKEN_SCOPE_INSUFFICIENT: "Gmail permission wasn't granted. Reconnect and tick the Gmail checkbox.",
    insufficientPermissions: "Gmail permission wasn't granted. Reconnect and tick the Gmail checkbox.",
  };
  const detail = [reason, err?.message].filter(Boolean).join(": ");
  return new Error(`${what} failed (${res.status})${detail ? ` — ${detail}` : ""}${reason && hints[reason] ? `. ${hints[reason]}` : ""}`);
}
