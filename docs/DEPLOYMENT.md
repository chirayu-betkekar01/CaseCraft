# Deployment

CaseCraft deploys to **Vercel as a single FastAPI app**. The whole backend becomes one
Python function; Vercel routes *every* path to it. `backend/api.py` serves `/api/*` and,
via its own SPA fallback, `/` and the client routes — one origin, no CORS layer.

The static build (`frontend/dist`) is promoted to Vercel's CDN at build time: the
`app.mount("/assets", StaticFiles(...))` in `backend/api.py` is detected and its files are
served from the edge, not the function. Only `index.html` (the SPA catch-all route) and
`/api/*` actually execute Python.

## The pieces, all committed

- **`pyproject.toml` → `[tool.vercel] entrypoint = "api.index:app"`** — this repo defines
  the app in `backend/api.py`, whose modules import each other by bare name
  (`from modeling import ...`, matching `pytest.ini`'s `pythonpath = backend`). Vercel would
  import `backend.api` as a package and those bare imports would fail, so `api/index.py` is
  a thin shim: it puts `backend/` on `sys.path`, loads `backend/api.py` by explicit file
  path, and re-exports `app`. The entrypoint points Vercel at that shim.
- **`vercel.json`**
  - `buildCommand` installs and builds the frontend (Vercel's build image includes Node).
  - `functions["api/index.py"]` — `includeFiles` keeps `backend/**` (so `value_drivers.yaml`
    ships in the bundle) and `frontend/dist/**` (so the SPA catch-all can read `index.html`)
    inside the function; `maxDuration` is raised to 60 s.
  - **No `outputDirectory`, no `rewrites`, no `api/[...path].py` catch-all file.** Those
    belong to the old "static site + separate serverless function" model. Setting
    `outputDirectory` puts the project back into static-site mode, where `api/index.py`
    only answers `/api` and every sub-path 404s.
- **`requirements.txt`** (repo root) — runtime deps as a plain list; Vercel's FastAPI
  builder installs it. `requirements-dev.txt` (adds uvicorn + pytest + httpx) is local/CI
  only. `api/requirements.txt` is a leftover identical copy from the old per-function model
  and is no longer read — kept in sync only so nothing silently drifts.
- **`.vercelignore`** — keeps tests, sample transcripts, and docs out of the deploy.

The SPA/static block in `backend/api.py` self-disables when `frontend/dist` is absent, so
local `pytest` (which never builds the frontend) is unaffected.

## First deploy

1. Push the repo to GitHub.
2. In Vercel: **Add New → Project → Import** the repo.
3. **Framework Preset: FastAPI.** This is the one setting that makes the whole thing work —
   "Other" leaves the project in static-site mode and the API 404s.
4. **Settings → Environment Variables**: add `OPENROUTER_API_KEY` for **Production** and
   **Preview**. (Skip only if you don't need `/api/transcript` — the rest of the app works
   without it.)
5. **Deploy.**
6. Verify:
   - `https://<project>.vercel.app/` loads the app.
   - `https://<project>.vercel.app/api/health` returns `{"status":"ok"}`.
   - `https://<project>.vercel.app/api/library` returns JSON.
7. Paste the live URL into the status line at the top of [`README.md`](../README.md).

## If a deploy fails

- **`/` loads but every `/api/*` returns 404** — the project is in static-site mode. Set
  Framework Preset to **FastAPI** and redeploy; make sure `vercel.json` has no
  `outputDirectory`.
- **Build error: `npm: command not found`** — rare, but if the build image lacks Node, move
  the build into `[tool.vercel.scripts] build = "..."` in `pyproject.toml` or set the
  Build Command in Project Settings.
- **Function 500s on a missing-file error for `value_drivers.yaml`** — check
  `functions."api/index.py".includeFiles` still lists `backend/**`.
- **`ModuleNotFoundError: api`** — add an empty `api/__init__.py` so `api.index` resolves as
  a regular package rather than relying on namespace-package resolution.

## Caveats on the free tier

- **Cold starts.** The first request after idle spins the function up; expect a beat.
- **`/api/transcript` latency.** The Claude Opus call can take tens of seconds.
  `maxDuration` is 60 s (the Hobby ceiling); if calls time out, that is the limit being
  hit — trim the prompt or move the backend off serverless (below).
- **No persistent filesystem.** Not needed here — the PDF is generated client-side and the
  library is read-only — but keep it in mind before adding anything stateful.

## Local production parity

```bash
npm --prefix frontend run build
.venv/Scripts/python.exe -m uvicorn api:app --app-dir backend --port 8000
```

Serves `/` and `/api` from one process on <http://localhost:8000> — the closest local
mirror of the deployed shape. `vercel dev` (CLI ≥ 48.1.8) mirrors it more exactly.

## Alternative: split frontend and backend

If cold starts or the 60 s serverless limit become a problem, run the backend as an
always-on container instead:

1. Deploy `backend/` to Render / Railway / Fly.io — start command
   `uvicorn api:app --app-dir backend --host 0.0.0.0 --port $PORT`, install
   `requirements-dev.txt` (for `uvicorn`) or add `uvicorn[standard]` to `requirements.txt`.
   Set `OPENROUTER_API_KEY` there.
2. Keep the frontend on Vercel as a **static** project (Framework Preset: **Vite**,
   output `frontend/dist`), and add a `rewrites` block that proxies to that host:
   ```json
   "rewrites": [
     { "source": "/api/:path*", "destination": "https://<your-backend-host>/api/:path*" }
   ]
   ```
   Drop the `functions` block, `pyproject.toml`'s `[tool.vercel]`, and `api/index.py`.

The frontend always calls a relative `/api`, so no frontend code changes either way.
