"""HTTP layer over the deterministic core.

Two paths, kept strictly apart — the same split the architecture is built on:

  GET  /api/library     the driver library, fetched once and cached by the client
  POST /api/case        recompute, called on every input change. No LLM, no
                        network, no I/O beyond the cached library parse.
  POST /api/transcript  the expensive path: one Claude call on an explicit rep
                        action, cached client-side and never re-run by an input
                        change.

/api/case must stay pure. Module 4 adds /api/narrative, which along with
/api/transcript will be the only endpoints that call Claude.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field

from modeling import DriverError, cash_flow_curve, compute_case, load_library
from models import WIRE, CaseMetrics, DealBasics, Library, TranscriptAnalysis
from transcript import (
    AnalysisUnavailable,
    TranscriptError,
    build_system_prompt,
    sanitize_analysis,
)
from transcript_client import analyze_transcript

# The one piece of process config this repo has: OPENROUTER_API_KEY, read by
# transcript.require_api_key(). Loaded once, explicitly from the repo root so
# it is found regardless of the working directory a shell happens to be in.
load_dotenv(Path(__file__).parent.parent / ".env")

FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"

app = FastAPI(
    title="CaseCraft API",
    description="Deterministic value modeling for cybersecurity platform business cases.",
    version="0.3.0",
)


@lru_cache(maxsize=1)
def library() -> Library:
    """Parsed once per process — the YAML never changes at runtime."""
    return load_library()


@lru_cache(maxsize=1)
def analysis_prompt() -> str:
    """The transcript instructions, built once per process from the library.

    Same caveat as library(): editing value_drivers.yaml against a server
    started without --reload serves the old catalog until restart.
    """
    return build_system_prompt(library())


# --- Wire models -------------------------------------------------------------


class CasePoint(BaseModel):
    """One month of the cumulative net position."""

    model_config = ConfigDict(extra="forbid")

    month: int
    net: float


class CaseRequest(BaseModel):
    model_config = WIRE

    deal: DealBasics
    selections: dict[str, dict[str, float]] = Field(
        default_factory=dict,
        description="Driver id -> input overrides. An empty object runs that driver on its defaults.",
    )
    global_values: dict[str, float] = Field(
        default_factory=dict,
        description="Customer answers to the shared inputs. Omitted keys fall back to library defaults.",
    )


class CaseResponse(BaseModel):
    model_config = WIRE

    metrics: CaseMetrics
    cash_flow: list[CasePoint]


class TranscriptRequest(BaseModel):
    """A sales call transcript, as plain text.

    Text in JSON rather than a multipart upload: the browser reads the file
    with File.text() and posts it here, which keeps the frontend on its single
    generic request helper and adds no Python dependency for parsing formats.

    The length bounds are enforced here so an empty box or a pasted novel is
    rejected before anything reaches the model.
    """

    model_config = WIRE

    transcript: str = Field(
        min_length=40,
        max_length=200_000,
        description="The call transcript. Cue markup is stripped client-side before sending.",
    )


# --- Routes ------------------------------------------------------------------


@app.get("/api/library", response_model=Library)
def get_library() -> Library:
    """The full driver library: shared inputs, overlap groups, and 12 drivers.

    The client fetches this once and drives the whole form from it, which is why
    every label, unit, default, and note lives in the YAML rather than in the UI.
    """
    return library()


@app.post("/api/case", response_model=CaseResponse)
def post_case(request: CaseRequest) -> CaseResponse:
    """Compute a full business case. Called on every slider drag."""
    try:
        metrics = compute_case(
            request.deal, request.selections, library(), request.global_values
        )
    except DriverError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    curve = cash_flow_curve(
        request.deal, metrics.total_annual_value, metrics.total_one_time_value
    )
    return CaseResponse(
        metrics=metrics,
        cash_flow=[CasePoint(month=month, net=net) for month, net in curve],
    )


@app.post("/api/transcript", response_model=TranscriptAnalysis)
def post_transcript(request: TranscriptRequest) -> TranscriptAnalysis:
    """Recommend value drivers from a sales call transcript.

    The expensive path. One Claude call, run on an explicit rep action and
    cached by the client — accepting a suggestion changes the selection, which
    recomputes through /api/case like any other input change, with no second
    call to the model.

    Nothing the model returns is trusted: sanitize_analysis() drops driver ids
    and shared inputs that are not in the library, and any quote that is not
    actually in the transcript.

    Sync `def` like every other handler here, which is right rather than an
    oversight: FastAPI runs sync handlers in a threadpool, so this multi-second
    call does not block concurrent /api/case recomputes.
    """
    try:
        raw = analyze_transcript(request.transcript, analysis_prompt())
    except AnalysisUnavailable as error:
        # 503, not 422: a missing key or an unreachable API is the server's
        # problem, and blaming the rep's transcript for it would be a lie.
        raise HTTPException(status_code=503, detail=str(error)) from error

    try:
        return sanitize_analysis(raw, library(), request.transcript)
    except TranscriptError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


# --- Static frontend ---------------------------------------------------------
# Mounted last so it never shadows /api. Present only after `npm run build`; in
# development the Vite dev server serves the app and proxies /api here.

if FRONTEND_DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def spa(full_path: str) -> FileResponse:
        """Every non-API route returns index.html so client routing works."""
        return FileResponse(FRONTEND_DIST / "index.html")
