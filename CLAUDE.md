# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

Being built module by module. The project is **CaseCraft** (renamed from its "Case Engine" working name). [ARCHITECTURE.md](ARCHITECTURE.md) is the original design note; it still predates the frontend rewrite — see "Divergences" below. [README.md](README.md) is the current project front door; [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) covers the Vercel setup.

**Built:** the deterministic core, the 12-driver library, a FastAPI layer, a React frontend, `/api/transcript` (Claude structured output — transcript to driver recommendations), and one-page PDF export.
**Not built yet:** `/api/lookup` (Claude web search) and `/api/narrative` (Claude structured output). Their slots exist in the UI and stay empty.

```
backend/    value_drivers.yaml · models.py · calculators.py · modeling.py · api.py
            transcript.py (pure) · transcript_client.py (the only network call)
frontend/   React + TypeScript (Vite); hand-rolled SVG charts, no chart library
            src/pdf/ — one-page PDF export via @react-pdf/renderer
tests/      backend: driver math, aggregation, HTTP contract, transcript sanitizing
```

Frontend tests are **not** in `tests/` — they sit beside the source as `frontend/src/lib/*.test.ts` and `frontend/src/pdf/*.test.ts`, covering axis scales, bar geometry, conflict filtering, and the PDF layout/page-count.

## Commands

```bash
# one-time: install Python deps (runtime + dev server + test tools)
.venv/Scripts/python.exe -m pip install -r requirements-dev.txt

# development — two processes
.venv/Scripts/python.exe -m uvicorn api:app --reload --app-dir backend
cd frontend && npm run dev            # :5173, proxies /api to :8000

# only /api/transcript needs a key; everything else runs without one.
# Put it in .env at the repo root (gitignored, loaded automatically), or:
$env:OPENROUTER_API_KEY = "sk-or-..."   # PowerShell, this session only

# production — one process; API serves the built frontend from /
cd frontend && npm run build
.venv/Scripts/python.exe -m uvicorn api:app --app-dir backend --port 8000

# tests
.venv/Scripts/python.exe -m pytest    # backend — no API key, no network
cd frontend && npm test               # frontend
cd frontend && npm run typecheck      # tsc -b --noEmit

# a single test
.venv/Scripts/python.exe -m pytest tests/test_modeling.py::test_illustrative_examples_are_correct
.venv/Scripts/python.exe -m pytest -k payback
cd frontend && npx vitest run -t "niceScale"
```

`pytest.ini` sets `pythonpath = backend` so tests import the modules flat (`from modeling import …`).

**There is no linter or formatter configured** — no ESLint, no Prettier, no ruff. `npm run typecheck` is the only static check; don't go looking for a lint step or add one uninvited.

## Vendor neutrality — hard constraint

No real vendor may be named anywhere in this repo: not in field values, comments, sample data, or file names. The product is always **"the Platform"**; the prior state is **"legacy tools"** or **"the current environment."** `test_no_vendor_names_anywhere` scans a list of files against a denylist. That test **asserts each file exists** rather than skipping — a moved file used to silently disable the check. If you add a source file with prose in it, add it to `SCANNED_FILES`.

## What the system does

A rep fills in deal basics, picks value drivers, and supplies the inputs those drivers need. The result is a numbers-first business case: deterministic Python math for the financials, Claude (later) for company research and narrative prose.

## The architectural rule that shapes everything

Two paths, kept strictly apart:

- **Expensive path — runs once, on submit.** Company lookup and narrative generation. Cached client-side, never re-run by an input change.
- **Cheap path — runs on every input change.** `POST /api/case` recomputes with **zero LLM calls**, debounced 90ms, aborting any in-flight request. Charts redraw; narrative text stays put.

`/api/case` must stay pure — no LLM, no network, no I/O beyond the cached library parse. The instant-feedback loop is the point of the demo.

A second rule: **Claude never invents numbers.** The narrative generator will receive already-computed metrics as fixed facts and only write prose around them.

## Value drivers

`backend/value_drivers.yaml` holds `globalInputs` (six shared customer variables), `overlapGroups`, and twelve drivers split 4/4/4 across Cost Savings, Productivity Gains, and Risk Reduction. Full schema in [README.md](README.md).

Adding a driver means **two** edits: a YAML entry and a `@calculator("<id>")` function in `calculators.py` with a matching id. `load_library()` raises if the two sets drift apart in either direction, and a test asserts the function's parameter names equal the driver's variable keys.

Invariants the engine depends on:

- **`formula.display` is a display string, never evaluated.** The registered Python function is the truth. The string is shown to the rep as "how we calculated this."
- **Every driver resolves to USD/year** — a bare `float`, or a `Value(annual, one_time)` for a driver with a one-time component (none currently use it; the path is kept and tested).
- **A `globalInput:`-sourced variable carries no `defaultValue`.** One default per number, living in `globalInputs`. `load_library()` enforces it.
- **Calculators receive resolved inputs only.** `resolve_inputs()` applies precedence (override → global value → variable default) and divides `percent` units by 100 — a calculator always sees `0.07`, never `7`. YAML defaults stay in human terms.
- **Every numeric default is an editable illustrative assumption**, never a cited statistic, and carries a `notes` field saying where a real number should come from.

**The library drives the UI.** Every label, unit, default, and note in the interface comes from the YAML over `/api/library` — nothing is duplicated in the frontend. Adding a driver requires no frontend change.

### Overlap groups

Declared as data so driver relationships never get hard-coded into UI logic. Each group names one `exclusive` driver that subsumes the others in `conflictsWith`; **members of `conflictsWith` do not conflict with each other**. `findConflicts` in `frontend/src/lib/conflicts.ts` deliberately mirrors `find_conflicts` in `modeling.py` so tile clicks give instant feedback with no round trip — the rules themselves still come from the library. The UI warns but never blocks: which drivers to present is the rep's judgment call.

### Known modeling caveat — do not "fix" silently

**Driver `tool-license-consolidation` subtracts Platform cost**, which double-counts against `CaseMetrics.tco`. It is correct as a standalone consolidation figure and is exactly what the driver brief specifies.

## Transcript analysis — the trust boundary

`POST /api/transcript` takes a call transcript and returns driver recommendations. It is the expensive path: one Claude call on an explicit click, cached client-side, never re-run by an input change.

The split across three files is deliberate and load-bearing:

- **`transcript.py` is pure** — prompt assembly and the sanitizer, no network, no SDK import. This is where the logic worth testing lives, and it is fully testable with no API key.
- **`transcript_client.py` is one function wide** — the only network call in the repo. Tests replace it with `monkeypatch.setattr(api, "analyze_transcript", ...)`.
- **Routed through OpenRouter, not Anthropic directly.** It's still Claude behind the call — OpenRouter's model slug is `anthropic/claude-opus-5` — but OpenRouter speaks the OpenAI-compatible chat completions schema, so the client uses the `openai` SDK pointed at `https://openrouter.ai/api/v1` rather than the `anthropic` SDK. Set `OPENROUTER_API_KEY`, not `ANTHROPIC_API_KEY`.
- **The `import openai` is deferred inside that function on purpose.** `api.py` imports the module at app construction and the tests build a `TestClient` at import time, so a top-level import would make the SDK a hard prerequisite for every test — including the deterministic ones that exist to prove the model needs no LLM. A test asserts `openai` is absent from `sys.modules` after importing `api`.

**Nothing the model returns is trusted.** `sanitize_analysis()` keeps or drops; it never rewrites a value, because a number the rep did not see is not one they can defend. Drivers and numbers are held to different standards on purpose:

| | Unknown id/key | Unverifiable quote |
|---|---|---|
| Driver suggestion | dropped | **kept**, quote blanked, confidence floored to `low` |
| Shared input value | dropped | **dropped entirely** |

A suggestion is something the rep evaluates; a number is something the rep defends. Everything dropped is listed in `discarded` and shown in the UI, so the filtering is visible rather than silent.

Conflicting recommendations **pass through unfiltered** — the UI warns but never blocks, and that rule doesn't change because the selection came from a transcript.

**The library is the only catalog.** The prompt is rendered from the parsed library at request time, so a driver added to the YAML becomes recommendable with no code change. `test_the_recommender_source_hard_codes_no_driver_id` reads `transcript.py` as text and fails if any driver id or global key is written into it.

## PDF export

`frontend/src/pdf/` — a pure frontend concern, zero backend/API involvement. Clicking **Export PDF** in `CaseView` calls `pdf(<BusinessCaseDocument .../>).toBlob()` (from `@react-pdf/renderer`) only on that click, never continuously — the same "expensive work runs once, on an explicit action" rule the transcript feature follows, just applied to a rendering cost instead of an LLM call. Deliberately not react-pdf's `PDFDownloadLink`, which would regenerate on every keystroke given the 90ms-debounced recompute already changing `metrics` that often.

Two decisions worth knowing before touching this code:

- **The PDF always renders in light mode**, via a literal hex palette in `pdfColors.ts` mirroring `tokens.css`'s light `:root` block — react-pdf understands neither CSS custom properties nor `color-mix()`. This is a deliberate, standard convention for an exported document, not a missed dark-mode case.
- **The on-screen Narrative section is deliberately excluded.** Every one of its five sections reads "Pending" until module 4 (narrative generation) exists; shipping five empty placeholders in an exported document would read as broken rather than "not built yet." Revisit this once that module ships.

`react-pdf`'s SVG-scoped `<Text>` has no font-size control at all (confirmed against its own type definitions) — this is why the contribution chart is built from flexbox `View`/`Text` rows rather than an SVG, unlike the cash-flow chart, which stays real SVG since it never needs to label anything inside it. `pdfLayout.ts` reuses `lib/chart.ts`'s `niceScale` unchanged (pure, no DOM) for both.

The one-pager fits all 12 of the library's drivers with real, full-length names — verified by hand, not assumed. An artificially short test fixture (`"Driver a"`) hid a real bug during development: without a fixed row height, long real driver names wrapped to two lines in the table and pushed the page count to 2. `BusinessCaseDocument.smoke.test.ts` now tests against the library's actual 12 driver names and asserts the generated PDF is exactly one page — if you add a 13th driver to the library, `CONTRIBUTION_DRIVER_LIMIT` in `pdfLayout.ts` (currently 12, a defensive ceiling rather than a display cut) is the thing to reconsider.

## Payback

`payback_months()` and `cash_flow_curve()` are solved from the same billing model — implementation plus year one up front, each renewal at its anniversary — so the KPI tile and the chart can never disagree. The loop walks year by year because cost is flat within a billing year; the final year's bound is inclusive (a crossing at the last month counts, since no further bill lands). Returns `0.0` when one-time value covers the outlay, `None` when the deal never pays back inside the term.

## API

Python keeps `snake_case` internally; the wire is `camelCase` via the `WIRE` config in `models.py` (a pydantic alias generator), so no internal names changed and `test_modeling.py` was untouched. `DriverError` maps to 422, not 500.

Two process-level behaviors that look like bugs if you hit them cold:

- **The library is parsed once per process** (`@lru_cache` on `library()` in `api.py`). Editing `value_drivers.yaml` against a server started without `--reload` serves the old library until restart.
- **The SPA catch-all is registered at import time, and only if `frontend/dist` exists.** Starting the API before `npm run build` gives a working `/api` but a 404 at `/`; building afterwards does nothing until you restart the server.

## Frontend

- **Charts are hand-rolled SVG** (`ContributionChart`, `CashFlowChart`) — full control over mark specs, no chart dependency. `useElementWidth` measures the container so text renders at true size instead of being scaled by a viewBox.
- **`niceScale()` in `lib/chart.ts` is load-bearing.** It picks one step across the whole span and widens the bounds out to it. Deriving positive and negative halves separately caused both classic failures: a domain ending below the data (line drawn outside the plot) and collided labels where a short negative arm got the same tick count as a long positive one. Both are covered by tests — don't "simplify" it back.
- **`barPath()`** rounds only the data-end; a plain `rx` would round all four corners and detach the bar from its baseline.
- **Palette**: `styles/tokens.css` carries the validated data-viz palette so charts and interface are one system. Categorical slots 1–3 map to the three categories in fixed order — **that ordering is the colorblind-safety mechanism, not cosmetic**. Aqua sits below 3:1 on the light surface, so direct value labels and the table view are **required relief, not decoration**.
- Both themes are selected, not flipped; dark values are declared under both `prefers-color-scheme` and `[data-theme]` so the toggle wins in both directions.

## Divergences from ARCHITECTURE.md

That doc predates two decisions and should be read with them in mind:

1. **Streamlit is gone.** Replaced with FastAPI + React because the demo link is the portfolio deliverable and Streamlit's ceiling was too low. This also drops the "free Streamlit Community Cloud deploy" pin — deployment is now a single service (API + built frontend) on a free tier.
2. **`formula` as a display string, not an evaluated expression.** ARCHITECTURE.md's schema sketch is ambiguous; the driver-calculator registry is the resolution.

## Scope discipline

The MVP pins: manual trigger, live Claude lookup (not a paid enrichment API), fixed 5-section narrative skeleton. Deferred: deal-tier/industry variants, Slack/CRM webhook triggers, PPTX export, persistent history, multi-user auth. Don't build deferred items without being asked.

**Driver selection is assisted, not automated.** Transcript analysis suggests drivers; the rep accepts each one. Nothing selects itself, and the manual picker remains the primary path — a case built with no transcript at all works exactly as before.
