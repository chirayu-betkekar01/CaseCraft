"""Tests for transcript analysis: prompt assembly and the sanitizer.

Everything here runs with no API key, no network, and without the model client
being importable — that is the point of keeping the pure logic in transcript.py
and the one network call somewhere else.

The sanitizer tests are the important ones. They describe what the system does
when the model returns something wrong, which is the only interesting question
about an interface between deterministic code and a language model.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from models import Confidence, Unit
from modeling import load_library
from transcript import (
    API_KEY_VAR,
    AnalysisUnavailable,
    RawAnalysis,
    RawGlobalValue,
    RawRecommendation,
    TranscriptError,
    build_system_prompt,
    build_user_message,
    quote_appears,
    render_overlap_rules,
    require_api_key,
    sanitize_analysis,
    value_is_plausible,
)

ROOT = Path(__file__).parent.parent
RECOMMENDER_SOURCE = ROOT / "backend" / "transcript.py"


@pytest.fixture(scope="module")
def library():
    return load_library()


SAMPLE_CALL = """\
Rep: Thanks for making the time. Where does the team feel the pain today?

Security Lead: Honestly, my team spends half their day chasing alerts that go
nowhere. Most of a shift disappears into triage before anyone touches real work.

Rep: How large is the estate?

Security Lead: We run about 4000 endpoints across the two sites.

Rep: And the tooling behind that?

Security Lead: We are paying for four different agents on the same box, and
finance has started asking pointed questions about the overlap.

Rep: Anything coming up on the risk side?

Security Lead: Our insurance renewal came back a lot higher than last year, and
they want evidence of endpoint controls before they will talk about the price.
"""


def raw(recommendations=(), global_values=()) -> RawAnalysis:
    """A model response, built from whatever the test cares about."""
    return RawAnalysis(
        recommendations=list(recommendations), global_values=list(global_values)
    )


def recommendation(driver_id, evidence, confidence=Confidence.HIGH, rationale="Because.") -> RawRecommendation:
    return RawRecommendation(
        driver_id=driver_id, confidence=confidence, evidence=evidence, rationale=rationale
    )


QUOTE = "my team spends half their day chasing alerts"
ENDPOINT_QUOTE = "We run about 4000 endpoints across the two sites"


# --- Prompt assembly ---------------------------------------------------------


def test_every_driver_in_the_library_appears_in_the_built_prompt(library):
    """A driver added to the YAML must become recommendable without an edit here."""
    prompt = build_system_prompt(library)

    for driver in library.drivers:
        assert driver.id in prompt, f"{driver.id} is missing from the candidate list"
        assert driver.name in prompt
        assert driver.shortDescription in prompt


def test_every_global_input_appears_in_the_built_prompt_with_its_current_default(library):
    """The model has to see the placeholder to know not to just repeat it back."""
    prompt = build_system_prompt(library)

    for shared in library.globalInputs:
        assert shared.key in prompt
        assert shared.label in prompt
        assert f"{shared.defaultValue:g}" in prompt


def test_overlap_group_guidance_reaches_the_prompt_verbatim(library):
    """That prose was written for this exact decision; paraphrasing loses it."""
    rules = render_overlap_rules(library)

    for group in library.overlapGroups:
        assert group.exclusive in rules
        assert group.guidance.strip() in rules
        for conflicting in group.conflictsWith:
            assert conflicting in rules


def test_the_prompt_explains_how_multiple_calls_are_marked_and_ordered(library):
    """A rep can upload several calls joined into one transcript. The model has
    to be told the '## filename' marker isn't dialogue, that calls run oldest
    to newest, and that a later call's number is the correction — this is the
    primary defense; sanitize_analysis's keep-last dedup is only the backstop."""
    prompt = build_system_prompt(library)

    assert "## " in prompt
    assert "chronological" in prompt
    assert "later call" in prompt


def test_the_recommender_source_hard_codes_no_driver_id(library):
    """The requirement, asserted directly.

    If someone special-cases a driver in the prompt or the sanitizer, the
    library stops being the single catalog and adding a driver silently stops
    being enough. Reading the source is the only way to catch that.
    """
    source = RECOMMENDER_SOURCE.read_text(encoding="utf-8")

    for driver in library.drivers:
        assert driver.id not in source, f"{driver.id} is hard-coded in transcript.py"
    for shared in library.globalInputs:
        assert shared.key not in source, f"{shared.key} is hard-coded in transcript.py"


def test_the_prompt_keeps_the_transcript_out_of_the_cacheable_half(library):
    """The library half is stable across calls; the transcript is not."""
    prompt = build_system_prompt(library)

    assert "<transcript>" not in prompt
    assert "<transcript>" in build_user_message(SAMPLE_CALL)


def test_the_model_is_given_no_field_for_deal_basics():
    """A closed schema says it more firmly than an instruction can."""
    with pytest.raises(ValidationError):
        RawAnalysis(recommendations=[], global_values=[], company_name="Northwind")


# --- Quote verification ------------------------------------------------------


def test_a_quote_matches_despite_whitespace_and_smart_quote_differences():
    """The three things a model reliably normalizes must not break a match."""
    transcript = "We don't have the headcount — it's a real problem."
    quote = "We  don’t have the headcount — It's a REAL problem."

    assert quote_appears(quote, transcript)


def test_a_quote_that_is_not_in_the_transcript_does_not_verify():
    assert not quote_appears("we are drowning in false positives", SAMPLE_CALL)


def test_a_paraphrase_of_a_real_line_does_not_verify():
    """Close is exactly what this check exists to reject."""
    assert not quote_appears("the team spends most of the day on alerts", SAMPLE_CALL)


def test_a_one_word_quote_does_not_count_as_verified():
    """A length floor is what stops the check from being theater."""
    assert not quote_appears("yes", SAMPLE_CALL)
    assert not quote_appears("Rep:", SAMPLE_CALL)


# --- Driver suggestions ------------------------------------------------------


def test_an_unknown_driver_id_is_dropped_from_the_suggestions(library):
    """The model can name a driver that does not exist. It never reaches the rep."""
    result = sanitize_analysis(
        raw([recommendation("a-driver-that-does-not-exist", QUOTE)]), library, SAMPLE_CALL
    )

    assert result.suggestions == []
    assert any("unknown driver" in note for note in result.discarded)


def test_a_repeated_driver_id_is_suggested_once(library):
    target = library.drivers[0].id
    result = sanitize_analysis(
        raw([recommendation(target, QUOTE), recommendation(target, QUOTE)]),
        library,
        SAMPLE_CALL,
    )

    assert [s.driver_id for s in result.suggestions] == [target]
    assert any("duplicate" in note for note in result.discarded)


def test_when_a_driver_is_recommended_twice_the_later_calls_evidence_wins(library):
    """A transcript can hold more than one call. If the model returns the same
    driver twice — most often because a later call restated it — the later
    entry wins, and the drop is never silent."""
    target = library.drivers[0].id
    result = sanitize_analysis(
        raw(
            [
                recommendation(target, QUOTE, confidence=Confidence.LOW),
                recommendation(target, ENDPOINT_QUOTE, confidence=Confidence.HIGH),
            ]
        ),
        library,
        SAMPLE_CALL,
    )

    assert len(result.suggestions) == 1
    kept = result.suggestions[0]
    assert kept.evidence == ENDPOINT_QUOTE
    assert kept.confidence is Confidence.HIGH
    assert any(
        "duplicate suggestion" in note and "kept" in note and "dropped" in note
        for note in result.discarded
    )


def test_a_suggestion_with_an_unverifiable_quote_keeps_the_driver_but_shows_no_quote(library):
    """The driver may well apply. The quote is what we refuse to display."""
    target = library.drivers[0].id
    result = sanitize_analysis(
        raw([recommendation(target, "a line nobody in this call ever said")]),
        library,
        SAMPLE_CALL,
    )

    assert len(result.suggestions) == 1
    assert result.suggestions[0].evidence == ""
    assert result.suggestions[0].quote_verified is False


def test_a_suggestion_with_an_unverifiable_quote_is_floored_to_low_confidence(library):
    target = library.drivers[0].id
    result = sanitize_analysis(
        raw([recommendation(target, "never said", confidence=Confidence.HIGH)]),
        library,
        SAMPLE_CALL,
    )

    assert result.suggestions[0].confidence is Confidence.LOW


def test_a_verified_quote_survives_exactly_as_the_rep_said_it(library):
    target = library.drivers[0].id
    result = sanitize_analysis(raw([recommendation(target, QUOTE)]), library, SAMPLE_CALL)

    assert result.suggestions[0].evidence == QUOTE
    assert result.suggestions[0].quote_verified is True


def test_suggestions_are_ordered_high_confidence_first(library):
    ids = [d.id for d in library.drivers[:3]]
    result = sanitize_analysis(
        raw(
            [
                recommendation(ids[0], QUOTE, confidence=Confidence.LOW),
                recommendation(ids[1], QUOTE, confidence=Confidence.HIGH),
                recommendation(ids[2], QUOTE, confidence=Confidence.MEDIUM),
            ]
        ),
        library,
        SAMPLE_CALL,
    )

    assert [s.confidence for s in result.suggestions] == [
        Confidence.HIGH,
        Confidence.MEDIUM,
        Confidence.LOW,
    ]


def test_a_suggestion_carries_the_librarys_name_and_category_not_the_models(library):
    """The library owns its own facts; the model only picks an id."""
    driver = library.drivers[0]
    result = sanitize_analysis(raw([recommendation(driver.id, QUOTE)]), library, SAMPLE_CALL)

    assert result.suggestions[0].name == driver.name
    assert result.suggestions[0].category == driver.category


def test_conflicting_recommendations_are_not_filtered_server_side(library):
    """The interface warns but never blocks. That rule does not change because
    the selection came from a transcript rather than from a click."""
    group = library.overlapGroups[0]
    result = sanitize_analysis(
        raw(
            [
                recommendation(group.exclusive, QUOTE),
                recommendation(group.conflictsWith[0], QUOTE),
            ]
        ),
        library,
        SAMPLE_CALL,
    )

    suggested = {s.driver_id for s in result.suggestions}
    assert group.exclusive in suggested
    assert group.conflictsWith[0] in suggested


# --- Shared input proposals --------------------------------------------------


def test_an_unknown_global_key_is_dropped_from_the_proposals(library):
    result = sanitize_analysis(
        raw(global_values=[RawGlobalValue(key="deviceCount", value=4000, evidence=ENDPOINT_QUOTE)]),
        library,
        SAMPLE_CALL,
    )

    assert result.global_proposals == []
    assert any("unknown shared input" in note for note in result.discarded)


def test_a_global_proposal_with_an_unverifiable_quote_is_dropped_entirely(library):
    """A suggestion is something the rep evaluates; a number is something the
    rep defends. A number whose source is not in the call never gets shown."""
    key = library.globalInputs[0].key
    result = sanitize_analysis(
        raw(global_values=[RawGlobalValue(key=key, value=4000, evidence="they told me offline")]),
        library,
        SAMPLE_CALL,
    )

    assert result.global_proposals == []
    assert any("unsourced value" in note for note in result.discarded)


@pytest.mark.parametrize("bad", [0.0, -1.0, float("nan"), float("inf")])
def test_a_zero_negative_or_non_finite_global_value_is_dropped(library, bad):
    key = library.globalInputs[0].key
    result = sanitize_analysis(
        raw(global_values=[RawGlobalValue(key=key, value=bad, evidence=ENDPOINT_QUOTE)]),
        library,
        SAMPLE_CALL,
    )

    assert result.global_proposals == []


def test_a_global_value_a_thousand_times_off_its_librarys_default_is_dropped(library):
    """The classic unit blunder: a salary given in thousands."""
    shared = library.globals_by_key["avgLoadedAnalystSalary"]
    assert not value_is_plausible(shared.defaultValue * 100_000, shared)
    assert value_is_plausible(shared.defaultValue * 2, shared)


def test_a_global_value_is_never_rescaled_or_rounded_on_its_way_through(library):
    """Silently adjusting a number the rep will have to defend is worse than
    dropping it. A count of 7.5 analysts is something a call can really say."""
    key = "secOpsTeamSize"
    result = sanitize_analysis(
        raw(global_values=[RawGlobalValue(key=key, value=7.5, evidence=ENDPOINT_QUOTE)]),
        library,
        SAMPLE_CALL,
    )

    assert result.global_proposals[0].value == 7.5


def test_a_proposal_carries_the_librarys_label_unit_and_current_default(library):
    shared = library.globals_by_key["endpointCount"]
    result = sanitize_analysis(
        raw(global_values=[RawGlobalValue(key=shared.key, value=4000, evidence=ENDPOINT_QUOTE)]),
        library,
        SAMPLE_CALL,
    )

    proposal = result.global_proposals[0]
    assert proposal.label == shared.label
    assert proposal.unit == shared.unit
    assert proposal.current_default == shared.defaultValue
    assert proposal.quote_verified is True


def test_when_two_calls_disagree_on_a_shared_input_the_later_value_wins(library):
    """The direct question this exists to answer: a discovery call says 5,000
    endpoints, a follow-up says it's actually 8,200. The later call is treated
    as the correction, and the conflict is named in `discarded`, not hidden."""
    transcript = (
        "## discovery-call.txt\n\n"
        "IT Director: We run about 5000 endpoints today.\n\n"
        "## follow-up-call.txt\n\n"
        "IT Director: Turns out it is actually 8200 endpoints once we counted properly.\n"
    )
    result = sanitize_analysis(
        raw(
            global_values=[
                RawGlobalValue(
                    key="endpointCount", value=5000,
                    evidence="We run about 5000 endpoints today",
                ),
                RawGlobalValue(
                    key="endpointCount", value=8200,
                    evidence="Turns out it is actually 8200 endpoints once we counted properly",
                ),
            ]
        ),
        library,
        transcript,
    )

    assert len(result.global_proposals) == 1
    assert result.global_proposals[0].value == 8200
    assert any(
        "duplicate value" in note and "8200" in note and "5000" in note
        for note in result.discarded
    )


def test_no_global_input_in_the_library_is_a_percent(library):
    """Percent values are written in human terms and divided by 100 before they
    reach a calculator. No shared input is a percent today, so the proposal path
    never has to make that conversion — if one is ever added, this fails and the
    scale decision gets made deliberately instead of by accident.
    """
    percents = [g.key for g in library.globalInputs if g.unit is Unit.PERCENT]

    assert percents == []


# --- Transcript and credentials ----------------------------------------------


def test_a_whitespace_only_transcript_is_rejected(library):
    with pytest.raises(TranscriptError):
        sanitize_analysis(raw(), library, "   \n\t  ")


def test_analysis_is_unavailable_when_the_api_key_is_absent(monkeypatch):
    monkeypatch.delenv(API_KEY_VAR, raising=False)

    with pytest.raises(AnalysisUnavailable):
        require_api_key()


def test_the_missing_key_message_names_the_environment_variable(monkeypatch):
    """Most of this repo runs with no key, so 'unset' is the normal state and a
    vague error would send someone hunting in the wrong place."""
    monkeypatch.delenv(API_KEY_VAR, raising=False)

    with pytest.raises(AnalysisUnavailable, match=API_KEY_VAR):
        require_api_key()


def test_a_blank_api_key_counts_as_absent(monkeypatch):
    monkeypatch.setenv(API_KEY_VAR, "   ")

    with pytest.raises(AnalysisUnavailable):
        require_api_key()
