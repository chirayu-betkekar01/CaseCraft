"""Tests for the HTTP layer.

The modeling itself is covered in test_modeling.py; these check the contract the
frontend depends on — shapes, camelCase keys, and error handling.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import api
from api import app
from transcript import AnalysisUnavailable, RawAnalysis, RawGlobalValue, RawRecommendation

client = TestClient(app)


@pytest.fixture(scope="module")
def library_json():
    response = client.get("/api/library")
    assert response.status_code == 200
    return response.json()


# --- /api/library ------------------------------------------------------------


def test_library_exposes_everything_the_form_needs(library_json):
    assert len(library_json["drivers"]) == 12
    assert len(library_json["globalInputs"]) == 6
    assert len(library_json["overlapGroups"]) == 2


def test_library_drivers_keep_their_authored_shape(library_json):
    driver = library_json["drivers"][0]
    assert set(driver) == {
        "id", "category", "name", "shortDescription", "narrative",
        "formula", "outputUnit", "illustrativeExample",
    }
    variable = driver["formula"]["variables"][0]
    assert {"key", "label", "unit", "source", "notes"} <= set(variable)


def test_overlap_groups_reach_the_client(library_json):
    """The frontend flags conflicts locally, so it needs the rules themselves."""
    group = next(g for g in library_json["overlapGroups"] if g["id"] == "analyst-capacity")
    assert group["exclusive"] == "headcount-avoidance-automation"
    assert len(group["conflictsWith"]) == 2
    assert group["guidance"]


# --- /api/case ---------------------------------------------------------------


DEAL = {
    "companyName": "Northwind Manufacturing",
    "annualCost": 280_000,
    "oneTimeCost": 60_000,
    "termYears": 3,
}


def post_case(**overrides):
    body = {"deal": DEAL, "selections": {}, "globalValues": {}} | overrides
    return client.post("/api/case", json=body)


def test_case_computes_a_driver_on_its_defaults():
    response = post_case(selections={"incident-response-retainer-avoidance": {}})
    assert response.status_code == 200

    metrics = response.json()["metrics"]
    assert metrics["totalAnnualValue"] == 170_000
    assert metrics["tco"] == 900_000
    assert len(metrics["drivers"]) == 1


def test_case_response_is_camel_case():
    """Python stays snake_case internally; the wire is camelCase."""
    body = post_case(selections={"cyber-insurance-premium-reduction": {}}).json()

    assert "totalAnnualValue" in body["metrics"]
    assert "total_annual_value" not in body["metrics"]
    assert "paybackMonths" in body["metrics"]
    assert "valueByCategory" in body["metrics"]
    assert body["metrics"]["drivers"][0]["driverId"] == "cyber-insurance-premium-reduction"
    assert "cashFlow" in body


def test_case_applies_driver_overrides():
    response = post_case(
        selections={"incident-response-retainer-avoidance": {"avgIREngagementCost": 170_000}}
    )
    assert response.json()["metrics"]["totalAnnualValue"] == 340_000


def test_case_applies_global_values():
    response = post_case(
        selections={"headcount-avoidance-automation": {}},
        globalValues={"secOpsTeamSize": 20},
    )
    assert response.json()["metrics"]["totalAnnualValue"] == 600_000


def test_cash_flow_spans_the_term_and_starts_at_the_upfront_outlay():
    curve = post_case(selections={"tool-license-consolidation": {}}).json()["cashFlow"]
    assert len(curve) == 3 * 12 + 1
    assert curve[0] == {"month": 0, "net": -340_000}


def test_payback_is_null_when_the_deal_never_catches_up():
    """None must survive as JSON null, not vanish or become 0."""
    body = post_case(
        selections={"cyber-insurance-premium-reduction": {}}  # $24.5k/yr against $900k
    ).json()
    assert body["metrics"]["paybackMonths"] is None


def test_empty_selection_is_a_valid_empty_case():
    body = post_case(selections={}).json()
    assert body["metrics"]["totalAnnualValue"] == 0
    assert body["metrics"]["drivers"] == []


def test_unknown_driver_is_a_422_not_a_500():
    response = post_case(selections={"teleportation-savings": {}})
    assert response.status_code == 422
    assert "teleportation-savings" in response.json()["detail"]


def test_unknown_driver_input_is_a_422():
    response = post_case(selections={"tool-license-consolidation": {"seats": 5}})
    assert response.status_code == 422
    assert "seats" in response.json()["detail"]


def test_malformed_deal_is_rejected():
    response = client.post("/api/case", json={"deal": {"companyName": "X", "annualCost": -5}})
    assert response.status_code == 422


def test_full_library_case():
    selections = {d["id"]: {} for d in client.get("/api/library").json()["drivers"]}
    metrics = post_case(selections=selections).json()["metrics"]
    assert metrics["totalAnnualValue"] == pytest.approx(2_230_073, rel=1e-4)
    assert len(metrics["drivers"]) == 12


def test_health():
    assert client.get("/api/health").json() == {"status": "ok"}


# --- /api/transcript ----------------------------------------------------------
# The one network call in the repo is replaced here with monkeypatch.setattr.
# That keeps the suite honest about its own rule — no API key, no network — and
# it is a real substitution rather than a stub: the fake returns a validated
# RawAnalysis, so every test below still runs the whole sanitizer, the wire
# serialization, and the error mapping.

CALL = """\
Rep: Where does the team feel the pain today?

Security Lead: my team spends half their day chasing alerts that go nowhere,
and we run about 4000 endpoints across the two sites.
"""

QUOTE = "my team spends half their day chasing alerts that go nowhere"
ENDPOINTS = "we run about 4000 endpoints across the two sites"


def fake_analysis(recommendations, global_values=()):
    """Build a stand-in for the model call that returns exactly these."""

    def run(_transcript: str, _prompt: str) -> RawAnalysis:
        return RawAnalysis(
            recommendations=list(recommendations), global_values=list(global_values)
        )

    return run


def post_transcript(transcript: str = CALL):
    return client.post("/api/transcript", json={"transcript": transcript})


def test_a_transcript_returns_ranked_suggestions_the_rep_can_confirm(monkeypatch):
    monkeypatch.setattr(
        api,
        "analyze_transcript",
        fake_analysis(
            [
                RawRecommendation(
                    driver_id="alert-fatigue-false-positive-reduction",
                    confidence="medium",
                    evidence=QUOTE,
                    rationale="The team loses a shift to triage.",
                ),
                RawRecommendation(
                    driver_id="analyst-investigation-triage-savings",
                    confidence="high",
                    evidence=QUOTE,
                    rationale="Investigation time is the stated problem.",
                ),
            ]
        ),
    )

    body = post_transcript().json()

    assert [s["confidence"] for s in body["suggestions"]] == ["high", "medium"]
    assert body["suggestions"][0]["evidence"] == QUOTE
    assert body["suggestions"][0]["quoteVerified"] is True


def test_transcript_suggestions_are_camel_case(monkeypatch):
    monkeypatch.setattr(
        api,
        "analyze_transcript",
        fake_analysis(
            [
                RawRecommendation(
                    driver_id="headcount-avoidance-automation",
                    confidence="high",
                    evidence=QUOTE,
                    rationale="Capacity, not hiring.",
                )
            ],
            [RawGlobalValue(key="endpointCount", value=4000, evidence=ENDPOINTS)],
        ),
    )

    body = post_transcript().json()

    assert "driverId" in body["suggestions"][0]
    assert "quoteVerified" in body["suggestions"][0]
    assert "driver_id" not in body["suggestions"][0]
    assert "currentDefault" in body["globalProposals"][0]
    assert body["globalProposals"][0]["value"] == 4000


def test_a_recommended_driver_id_can_be_fed_straight_back_into_the_case_endpoint(monkeypatch):
    """The Accept button does exactly this. If the ids ever drift apart the
    button would silently 422 with nothing to show the rep."""
    monkeypatch.setattr(
        api,
        "analyze_transcript",
        fake_analysis(
            [
                RawRecommendation(
                    driver_id="tool-license-consolidation",
                    confidence="high",
                    evidence=QUOTE,
                    rationale="Overlapping agents.",
                )
            ]
        ),
    )

    suggested = post_transcript().json()["suggestions"][0]["driverId"]

    assert post_case(selections={suggested: {}}).status_code == 200


def test_a_driver_id_the_model_invented_never_reaches_the_client(monkeypatch):
    monkeypatch.setattr(
        api,
        "analyze_transcript",
        fake_analysis(
            [
                RawRecommendation(
                    driver_id="quantum-synergy-savings",
                    confidence="high",
                    evidence=QUOTE,
                    rationale="Invented.",
                )
            ]
        ),
    )

    body = post_transcript().json()

    assert body["suggestions"] == []
    assert body["discarded"]


def test_an_empty_transcript_is_rejected_before_the_model_is_ever_called(monkeypatch):
    def explode(*_args):
        raise AssertionError("the model was called for an empty transcript")

    monkeypatch.setattr(api, "analyze_transcript", explode)

    assert post_transcript("").status_code == 422
    assert post_transcript("too short").status_code == 422


def test_a_transcript_longer_than_the_cap_is_rejected(monkeypatch):
    def explode(*_args):
        raise AssertionError("the model was called for an oversized transcript")

    monkeypatch.setattr(api, "analyze_transcript", explode)

    assert post_transcript("x" * 200_001).status_code == 422


def test_a_missing_api_key_is_a_clear_503_not_a_500(monkeypatch):
    """Unset is the normal state for the rest of this repo, so the message has
    to say which variable and that only this feature needs it."""

    def unavailable(*_args):
        raise AnalysisUnavailable("OPENROUTER_API_KEY is not set.")

    monkeypatch.setattr(api, "analyze_transcript", unavailable)

    response = post_transcript()
    assert response.status_code == 503
    assert "OPENROUTER_API_KEY" in response.json()["detail"]


def test_an_upstream_rate_limit_is_a_503_not_a_500(monkeypatch):
    def unavailable(*_args):
        raise AnalysisUnavailable("Rate limited while analyzing the call.")

    monkeypatch.setattr(api, "analyze_transcript", unavailable)

    assert post_transcript().status_code == 503


def test_importing_the_app_does_not_pull_in_the_model_sdk():
    """The deterministic core must not gain an LLM dependency at import time.

    transcript_client defers `import openai` into the one function that calls
    out — the transcript feature is routed through OpenRouter's OpenAI-
    compatible API rather than Anthropic directly. If someone moves the import
    to module scope, the SDK silently becomes a prerequisite for every test in
    this repo, including the ones that exist to prove the financial model
    never needs it.
    """
    import sys

    assert "api" in sys.modules, "this test is meaningless if api was never imported"
    assert "openai" not in sys.modules
