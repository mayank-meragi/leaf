# 🍃 Leaf

A personal finance tracker with **no backend**. It runs entirely in your browser:

- **Gmail (multiple accounts)** → bank, card and UPI alert emails are read-only fetched and turned into transactions by **OpenAI**.
- **Mutual funds** → CAMS / KFintech **detailed CAS** PDFs (from Gmail or uploaded) are decrypted and parsed locally with pdf.js,
  or upload MF Central's **CAS detailed report (.xlsx)**.
- **Categories** → pick or create one from any transaction. Tagging a counterparty re-tags its history and becomes a rule for future syncs.
- **Storage** → everything is JSON in a **private GitHub repo** you own. Every sync is one commit, so git history is your audit log.

```
Browser (Leaf SPA)
 ├── Google Identity Services ── gmail.readonly token per account (1h, in sessionStorage)
 ├── OpenAI API ─────────────── alert emails → structured transactions (+ category)
 ├── pdf.js + CAS parser ────── CAS PDF → folios / schemes / transactions / valuation
 └── GitHub REST API ────────── read/commit JSON in <you>/leaf-data
```

## Data repo layout

```
config.json                 connected accounts, sync cursors, CAS password, custom categories, category rules
transactions/YYYY-MM.json   transactions for that month
mf/<to-date>--<id>.json     one parsed CAS statement per file
```

## Setup

1. **Data repo**: create a private repo (e.g. `leaf-data`). Then create a
   [fine-grained token](https://github.com/settings/personal-access-tokens/new) limited to that repo with
   **Contents: Read and write**.
2. **OpenAI key**: from [platform.openai.com](https://platform.openai.com/api-keys).
3. **Google OAuth client** (for Gmail):
   - In Google Cloud Console, create a project and enable the **Gmail API**.
   - OAuth consent screen: *External*, publishing status **Testing**, and add each Gmail address you'll connect as a **test user**.
     (`gmail.readonly` is a restricted scope; Testing mode avoids Google's verification for personal use.)
   - Credentials → *OAuth client ID* → *Web application*. Authorized JavaScript origins:
     `http://localhost:5180` (and `https://<you>.github.io` if you deploy).
   - Paste the client ID in **Settings → Other devices** (it's stored in your data repo's `config.json`, so every
     device picks it up). Optionally set `VITE_GOOGLE_CLIENT_ID` in `.env.local` for the very first run; Leaf
     moves it into the repo automatically.
4. Run it:

   ```bash
   pnpm install
   pnpm dev
   ```

5. In the app, enter the repo, token and OpenAI key, then go to **Settings → Connect Gmail account** (repeat per account),
   set your **CAS password** (PAN in capitals), and hit **Sync**.

For mutual funds, request a **detailed** CAS from [CAMS](https://www.camsonline.com/Investors/Statements/Consolidated-Account-Statement)
to a connected inbox. The next sync picks it up, or you can upload the PDF on the Investments tab.

## Deploying (optional)

`.github/workflows/pages.yml` builds and publishes to GitHub Pages on push to `main`. Enable Pages
(source: GitHub Actions) and add the Pages origin (e.g. `https://<you>.github.io`) to your OAuth client's
Authorized JavaScript origins. The site holds no data; every visitor brings their own GitHub token.

**Other devices (e.g. your phone):** open the deployed site, enter the data repo and a GitHub token. The Google
client ID comes from `config.json`; the OpenAI key too, if you chose **Settings → Other devices → Save this
device's key to repo**.

## Security notes

- Tokens and API keys are stored in the browser (localStorage / sessionStorage) and are sent only to GitHub, Google and OpenAI.
- Your financial data lives in your private repo. Anyone with access to that repo can read it.
- Email text is sent to the OpenAI API for extraction. OpenAI's API data-usage policy applies to it.

## Development

```bash
pnpm test        # CAS parser tests
pnpm typecheck
pnpm build
```
