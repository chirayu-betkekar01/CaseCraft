# Deployment

CaseCraft deploys as **one Vercel project**: the Vite build is served as static output,
and the FastAPI backend runs as a single Python serverless function under `/api`. Because
both are served from the same origin, there is no CORS layer to configure.

## How it maps

| Request | Served by |
|---|---|
| `/`, `/assets/*`, any non-API path | Static files from `frontend/dist` (Vercel CDN) |
| `/api/*` | `api/[...path].py` → the FastAPI `app` (Python serverless function) |

The pieces that make this work, all committed:

- **`vercel.json`** — `buildCommand` installs and builds the frontend; `outputDirectory`
  points at `frontend/dist`; `functions` bundles `backend/**` into the function (so
  `value_drivers.yaml` ships with it) and raises `maxDuration` to 60 s. **No `rewrites`** —
  Vercel now forwards the *rewritten* path to backend functions, which would break the
  `/api/...` routes, so routing is done by filename instead.
- **`api/[...path].py`** — a catch-all route filename, so every `/api/*` request lands here
  with its original path intact and FastAPI's own `/api/...` routes match. It puts
  `backend/` on `sys.path` (its modules import each other flat) and loads `backend/api.py`
  by explicit path. Vercel's Python runtime serves the module-level ASGI `app`.
- **`requirements.txt`** — runtime deps, as a plain list (Vercel's builder can't parse
  `-r` includes). `api/requirements.txt` is an identical copy next to the function.
  `requirements-dev.txt` (adds uvicorn + pytest + httpx) is for local dev and CI only.
- **`.vercelignore`** — keeps tests, sample transcripts, and docs out of the deploy.

The SPA/static-file block in `backend/api.py` self-disables when `frontend/dist` is absent
(which it is inside the function bundle), so the function only ever answers `/api/*`.

## First deploy

1. Push the repo to GitHub.
2. In Vercel: **Add New → Project → Import** the repo. Framework preset: **Other**
   (`vercel.json` drives the build).
3. **Settings → Environment Variables**: add `OPENROUTER_API_KEY` for **Production** and
   **Preview**. (Skip only if you don't need `/api/transcript` — the rest of the app works
   without it.)
4. **Deploy.**
5. Verify:
   - `https://<project>.vercel.app/` loads the app.
   - `https://<project>.vercel.app/api/library` returns JSON.
   - `https://<project>.vercel.app/api/health` returns `{"status":"ok"}`.
6. Paste the live URL into the status line at the top of [`README.md`](../README.md).

## Caveats on the free tier

- **Cold starts.** The first request after idle spins the function up; expect a beat.
- **`/api/transcript` latency.** The Claude Opus call can take tens of seconds.
  `maxDuration` is set to 60 s (the Hobby ceiling); if calls time out, that is the limit
  being hit — trim the prompt or move the backend off serverless (below).
- **No persistent filesystem.** Not needed here — the PDF is generated client-side and the
  library is read-only — but keep it in mind before adding anything stateful.
- **`value_drivers.yaml` must ship with the function.** Handled by
  `functions."api/[...path].py".includeFiles: "backend/**"` in `vercel.json`; if the
  function 500s on a missing-file error, check that entry.

## Local production parity

```bash
npm --prefix frontend run build
.venv/Scripts/python.exe -m uvicorn api:app --app-dir backend --port 8000
```

Serves `/` and `/api` from one process on <http://localhost:8000> — the closest local
mirror of the deployed shape.

## Alternative: split frontend and backend

If cold starts or the serverless time limit become a problem, run the backend as an
always-on container instead:

1. Deploy `backend/` to Render / Railway / Fly.io — start command
   `uvicorn api:app --app-dir backend --host 0.0.0.0 --port $PORT`, install
   `requirements-dev.txt` (for `uvicorn`) or add `uvicorn[standard]` to
   `requirements.txt`. Set `OPENROUTER_API_KEY` there.
2. Keep the frontend on Vercel, but add a `rewrites` block to `vercel.json` that proxies
   to that host:
   ```json
   "rewrites": [
     { "source": "/api/:path*", "destination": "https://<your-backend-host>/api/:path*" }
   ]
   ```
   and drop the `functions` block and `api/[...path].py`.

The frontend still calls a relative `/api`, so no frontend code changes either way.
