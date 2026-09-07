# Value Driver Library — cybersecurity platform (EDR/XDR class)

> Reference doc for the driver library and the HTTP contract around it.
> For the project overview, quick start, and architecture, see the
> [root README](../README.md).

A structured, reusable data asset that quantifies the dollar value a modern
endpoint security platform delivers versus a customer's current environment.
It is designed to be consumed by a value/ROI calculator used in sales
conversations.

The library is vendor-neutral by construction: the product is always **"the
Platform"** and the prior state is **"legacy tools"** or **"the current
environment."** No real vendor is named anywhere, and a test enforces it.

## Files

| File | What it holds |
|---|---|
| `backend/value_drivers.yaml` | **The library.** `globalInputs` + `overlapGroups` + 12 drivers. |
| `backend/models.py` | Pydantic schema for the library and the computed case. |
| `backend/calculators.py` | One function per driver — the machine-usable form of each formula. |
| `backend/modeling.py` | Loads the library, resolves inputs, computes and aggregates a case. |
| `backend/api.py` | FastAPI: `/api/library`, `/api/case`, `/api/transcript`, and the built frontend in production. |
| `backend/transcript.py` | Prompt assembly from the library, and the sanitizer that decides what the model is allowed to show. Pure — no network. |
| `backend/transcript_client.py` | The one network call in the repo, kept to a single function. |
| `frontend/src/` | React + TypeScript interface. Charts are hand-rolled SVG — no chart library. |
| `tests/` | Backend: driver math, aggregation, and the HTTP contract. |
| `frontend/src/lib/*.test.ts` | Frontend: axis scales, bar geometry, conflict and input filtering. |

## Running it

Two processes in development; one in production.

```bash
# terminal 1 — API on :8000
.venv/Scripts/python.exe -m uvicorn api:app --reload --app-dir backend

# terminal 2 — UI on :5173, proxying /api to the backend
cd frontend && npm run dev
```

```bash
# production: build the frontend, then the API serves it from / on :8000
cd frontend && npm run build
.venv/Scripts/python.exe -m uvicorn api:app --app-dir backend --port 8000
```

Tests:

```bash
.venv/Scripts/python.exe -m pytest    # backend suite — no API key, no network
cd frontend && npm test               # frontend suite
cd frontend && npm run typecheck
```

YAML was chosen over JSON for one reason: the `notes` and `narrative` fields
carry real prose, and YAML block scalars keep them readable and diff-friendly.

## Structure

```yaml
globalInputs:          # shared customer variables, collected once
  - key: endpointCount
    label: "Endpoints under management"
    unit: count
    defaultValue: 5000
    notes: "..."

drivers:
  - id: kebab-case-id
    category: "Cost Savings | Productivity Gains | Risk Reduction"
    name: "..."
    shortDescription: "..."
    narrative: "..."           # 2-4 sentences, for a sales conversation
    formula:
      display: "Value = ..."   # human-readable
      variables:
        - key: someVariable
          label: "..."
          unit: USD/year
          source: driverInput            # or "globalInput:<key>"
          defaultValue: 1000             # driverInput only
          notes: "..."
    outputUnit: "USD/year"
    illustrativeExample:
      assumptions: "..."
      calculatedValue: 0
```

## Conventions

- **Every driver resolves to USD/year**, so aggregation across selected drivers
  is a straight sum with no unit reconciliation.
- **`formula.display` is display only and is never evaluated.** The registered
  function in `calculators.py` is the source of truth. `load_library()` fails if
  the two drift apart, and a test asserts each function's parameter names equal
  its driver's variable keys.
- **A `globalInput:`-sourced variable carries no `defaultValue`.** The value and
  its default live in `globalInputs`, so there is exactly one default per number
  and no second copy to go stale.
- **`percent` values are written in human terms** (`7` means 7%) and normalized
  to a fraction before reaching a calculator.
- **Analyst hourly rate is derived**, not collected: `avgLoadedAnalystSalary / 2080`.
- **Every numeric default is an editable illustrative assumption** — a plausible
  round placeholder, not a cited statistic. Override with real customer or
  industry data before a case goes anywhere externally.

## The 12 drivers

| # | Driver | Category | Illustrative value |
|---|---|---|---|
| 1 | Tool & License Consolidation Savings | Cost Savings | $170,000 |
| 2 | Data Ingestion & Infrastructure Cost Reduction | Cost Savings | $75,000 |
| 3 | Cyber Insurance Premium Reduction | Cost Savings | $24,500 |
| 4 | Incident Response Retainer & Forensics Cost Avoidance | Cost Savings | $170,000 |
| 5 | Analyst Investigation & Triage Time Savings | Productivity Gains | $389,423 |
| 6 | Alert Fatigue & False-Positive Reduction | Productivity Gains | $161,538 |
| 7 | Headcount Avoidance via Automation | Productivity Gains | $240,000 |
| 8 | Reduced End-User Downtime from Faster Remediation | Productivity Gains | $123,750 |
| 9 | Breach Probability & Expected-Loss Reduction | Risk Reduction | $526,500 |
| 10 | Compliance, Audit & Regulatory Fine Avoidance | Risk Reduction | $55,962 |
| 11 | Ransomware Business Interruption & Ransom Payment Avoidance | Risk Reduction | $180,000 |
| 12 | Customer Churn & Reputational Damage Avoidance | Risk Reduction | $113,400 |

All twelve run on the same illustrative profile: 5,000 endpoints, an 8-person
SecOps team, $150k loaded analyst salary, $450k legacy tool stack.

## Two things a consuming calculator must handle

These are properties of the driver set, not bugs. They need a decision at the
calculator layer rather than a silent fix in the data.

**1. Driver 1 double-counts Platform cost against a TCO line.** Its formula is
`currentToolStackAnnualCost − newPlatformAnnualCost`, which is correct as a
standalone consolidation figure. But a calculator that also models the Platform
subscription as a cost — in a TCO, ROI, or payback line — subtracts it twice.
Either present driver 1 standalone, or switch it to gross displaced spend
(`currentToolStackAnnualCost` alone) and let the cost side carry the subscription.

**2. Some drivers overlap and cannot all be claimed at full value.** These are
declared as data in the `overlapGroups` section, so a calculator can enforce
them rather than hard-coding driver relationships in UI logic:

| Group | `exclusive` driver | conflicts with | Why |
|---|---|---|---|
| `analyst-capacity` | 7 Headcount Avoidance | 5, 6 | Avoided hires and reclaimed analyst hours are the same freed capacity, monetized two ways. |
| `breach-probability` | 9 Breach Expected-Loss | 11, 12 | Expected loss already prices the full consequence of the same probability improvement. |

The `exclusive` driver subsumes the others; **drivers inside `conflictsWith` do
not conflict with each other.** Drivers 5 and 6 sit together safely — one counts
alerts escalated to investigation, the other counts alerts dismissed at triage,
which are different populations. Likewise 11 and 12 are compatible: a ransom
payment and post-breach customer churn are distinct consequences.

`modeling.find_conflicts(library, selected)` returns the violated groups, and
the app surfaces them as warnings at selection time. It warns rather than blocks
— which drivers to present is a judgment call for the rep, not the tool.

## The HTTP contract

`GET /api/library` returns the library verbatim — the client drives the entire
form from it, which is why every label, unit, default, and note lives in the
YAML rather than in the UI.

`POST /api/case` computes a case. Python keeps `snake_case` internally; the wire
is `camelCase`, via serialization aliases rather than any renaming:

```jsonc
// request
{
  "deal": { "companyName": "Northwind", "annualCost": 280000,
            "oneTimeCost": 60000, "termYears": 3 },
  "selections": { "tool-license-consolidation": { "newPlatformAnnualCost": 300000 } },
  "globalValues": { "endpointCount": 12000 }
}
// response
{ "metrics": { "totalAnnualValue": 170000, "roiPct": 643.0, "paybackMonths": 1.8, … },
  "cashFlow": [ { "month": 0, "net": -340000 }, … ] }
```

`/api/case` is pure: no LLM, no network, no I/O beyond the cached library parse.

`POST /api/transcript` is the expensive path — one Claude call, run on an
explicit click and cached by the client, so accepting a suggestion recomputes
through `/api/case` with no second call to the model:

```jsonc
// request
{ "transcript": "Rep: Where does the team feel the pain today? ..." }
// response
{ "suggestions": [ { "driverId": "analyst-investigation-triage-savings",
                     "name": "Analyst Investigation & Triage Time Savings",
                     "confidence": "high",
                     "evidence": "my team spends half their day chasing alerts",
                     "rationale": "…", "quoteVerified": true } ],
  "globalProposals": [ { "key": "endpointCount", "value": 4000,
                         "currentDefault": 5000,
                         "evidence": "we run about 4000 endpoints",
                         "quoteVerified": true } ],
  "discarded": [] }
```

Nothing the model returns is trusted. Driver ids and shared-input keys that are
not in the library are dropped, and every quote is verified against the
transcript it came from. A driver whose quote cannot be found keeps its place
but loses the quote and drops to `low`; a *number* whose quote cannot be found
is discarded outright — a suggestion is something the rep evaluates, a number is
something the rep has to defend. Everything dropped is listed in `discarded`.

This is the one endpoint that needs a key. It is routed through OpenRouter
rather than Anthropic directly — same model (`anthropic/claude-opus-5` on
OpenRouter's catalog), different wire format and SDK:

```bash
export OPENROUTER_API_KEY="sk-or-..."   # PowerShell: $env:OPENROUTER_API_KEY = "..."
```

Without it the endpoint returns a 503 naming the variable; the rest of the app,
and the whole test suite, run without one. Module 4 adds `/api/narrative`.

## Consuming the library directly

```python
from modeling import compute_case, load_library
from models import DealBasics

library = load_library()

deal = DealBasics(company_name="Northwind Manufacturing",
                  annual_cost=280_000, one_time_cost=60_000, term_years=3)

metrics = compute_case(
    deal,
    selections={                                  # driver id -> input overrides
        "incident-response-retainer-avoidance": {"avgIREngagementCost": 110_000},
        "headcount-avoidance-automation": {},     # empty = run on defaults
    },
    library=library,
    global_values={"endpointCount": 12_000},      # customer's shared answers
)

metrics.total_annual_value, metrics.roi_pct, metrics.payback_months
```

Input precedence per variable: an explicit override, then the `globalInputs`
value for a global-sourced variable, then the variable's own `defaultValue`.

## Tests

```bash
.venv/Scripts/python.exe -m pytest tests/test_modeling.py::test_illustrative_examples_are_correct
```

The backend suite covers the acceptance criteria directly: 12 drivers split
4/4/4, every field populated, all six global inputs defined and referenced, no
vendor names in any file, and every `illustrativeExample.calculatedValue`
recomputed from that driver's own stated defaults.
