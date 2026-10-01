# Leaf backend

A small Python helper that runs **on your own computer**. The Leaf app is a static page, and some data (fund
holdings) comes from a source that doesn't allow requests from web pages. So the app asks this helper to fetch it.

Nothing here is hosted, scheduled or deployed.

## Fund holdings and expense ratios

Start the helper (Python 3.9+ with working HTTPS, no packages to install), and leave it running while you use the app:

```bash
pnpm holdings-helper        # or: sh backend/run_helper.sh
```

The launcher picks the first Python on your machine that can make HTTPS requests. That matters more than it sounds: a
pyenv build missing its OpenSSL imports fine but can't fetch anything, and plain `python3` is often that one. To choose
one yourself, set `LEAF_PYTHON=/path/to/python`. If the interpreter is unusable the helper says so at startup instead of
failing scheme by scheme.

Then open **Investments > Look-through** and click **Sync fund holdings**. The helper fetches each fund's stock
holdings, weights, sectors and expense ratio. The app then saves them to your data repo as
`holdings/<amfi code>.json` in one commit, using the GitHub token it already has. Everything else on that tab
(overlap, what you really own, costs) reads those files, so the helper only needs to run when you sync.

The first time, use **Investments > Performance > Load NAV history** so each scheme has an AMFI code.

Funds disclose portfolios once a month, so syncing monthly is plenty. Files fetched in the last 20 days are skipped.

### What the helper does and doesn't do

- Listens on `127.0.0.1` only, never on your network.
- Answers browser requests only from the Leaf dev server (`http://localhost:5180`). Add other origins with
  `--origin https://...`; any other website is refused.
- Holds no tokens and writes nothing: it returns data, and the app does the saving.
- Regular plans reuse their Direct twin's holdings (the same portfolio) and have no expense ratio, because the
  source lists only Direct plans.

The source is Groww's public scheme endpoint. It's undocumented and could change; if it does, the sync reports
which schemes failed rather than saving guesses.

### Without the app

The same code can write straight into a checkout of the data repo:

```bash
git clone git@github.com:you/leaf-data.git ../leaf-data
python3 -m leaf_backend.sync --data-dir ../leaf-data --force
cd ../leaf-data && git add holdings && git commit -m "Update fund holdings" && git push
```

### Tests

```bash
pnpm test:backend           # or: cd backend && python3 -m unittest discover -s tests -t .
```
