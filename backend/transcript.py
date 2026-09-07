"""Turn a sales call transcript into value driver recommendations.

Everything in this module is pure: prompt assembly from the parsed library,
and the sanitizer that decides what the model is allowed to tell the rep. There
is no network call and no LLM client here — that lives in transcript_client.py,
which is one function wide precisely so this file can be tested with no API key.

Two properties this module exists to guarantee:

**The library is the only catalog.** The prompt is rendered from the parsed
library at request time, so a driver added to value_drivers.yaml becomes
recommendable with no edit here. No driver id is written into this file, and a
test reads this source to prove it.

**Nothing the model returns is trusted.** It can name a driver that does not
exist, a shared input that does not exist, a value off by a factor of a
thousand, or quote a line nobody said. sanitize_analysis() keeps or drops; it
never rewrites a value, because a number the rep did not see is not a number
the rep can defend in front of a CFO.

Vendor-neutral by design: the product is "the Platform", the prior state is
"legacy tools" or "the current environment".
"""

from __future__ import annotations

import math
import os

from pydantic import BaseModel, ConfigDict

from models import (
    Confidence,
    DriverSuggestion,
    GlobalInput,
    GlobalProposal,
    Library,
    TranscriptAnalysis,
)

API_KEY_VAR = "OPENROUTER_API_KEY"
"""The transcript client is routed through OpenRouter, not Anthropic directly
— see transcript_client.py for why."""

MIN_QUOTE_CHARS = 12
"""Shortest quote that can count as verified. Without a floor, a one-word quote
matches almost any transcript and the whole check becomes theater."""

SCALE_TOLERANCE = 1000.0
"""How far a proposed shared-input value may sit from the library's own default
before it is treated as a unit blunder rather than an unusual customer."""

CONFIDENCE_RANK = {Confidence.HIGH: 0, Confidence.MEDIUM: 1, Confidence.LOW: 2}


class TranscriptError(ValueError):
    """The transcript itself is unusable."""


class AnalysisUnavailable(RuntimeError):
    """The analysis could not be run at all — no API key, or the call failed.

    Distinct from TranscriptError: nothing is wrong with what the rep sent.
    """


# --- What the model is constrained to return ---------------------------------
# Deliberately separate from the models in models.py. These carry only what
# Claude produces; every library fact is filled in afterwards from the library
# itself. Keeping the shapes apart is what makes it impossible for the model to
# restate a driver's name or a unit incorrectly.
#
# Every field is required and no field is nullable — an optional field can be
# rejected when the schema is enforced strictly. "Nothing here" is "" or [].


class RawRecommendation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    driver_id: str
    confidence: Confidence
    evidence: str
    rationale: str


class RawGlobalValue(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key: str
    value: float
    evidence: str


class RawAnalysis(BaseModel):
    """The model's unvalidated answer. Never returned to a client as-is.

    Note what has no field here: company name, deal size, contract term. The
    deal basics are the rep's to enter, and a closed schema is a firmer way to
    say so than an instruction.
    """

    model_config = ConfigDict(extra="forbid")

    recommendations: list[RawRecommendation]
    global_values: list[RawGlobalValue]


# --- Prompt assembly ---------------------------------------------------------


def render_driver_catalog(library: Library) -> str:
    """Every driver in the library, as the candidate list to match against.

    `narrative` carries the most weight: it is prose describing the customer
    situation the driver applies to, which is exactly the thing a transcript
    contains. The variable labels and notes come along as the concrete signals
    to listen for.
    """
    blocks = []
    for driver in library.drivers:
        signals = "\n".join(
            f"      - {variable.label} ({variable.unit}) — {variable.notes}"
            for variable in driver.formula.variables
        )
        blocks.append(
            f'  <driver id="{driver.id}" category="{driver.category}">\n'
            f"    <name>{driver.name}</name>\n"
            f"    <summary>{driver.shortDescription}</summary>\n"
            f"    <when-it-applies>{driver.narrative.strip()}</when-it-applies>\n"
            f"    <how-it-is-computed>{driver.formula.display}</how-it-is-computed>\n"
            f"    <signals-to-listen-for>\n{signals}\n    </signals-to-listen-for>\n"
            f"  </driver>"
        )
    return "<value-drivers>\n" + "\n".join(blocks) + "\n</value-drivers>"


def render_globals_catalog(library: Library) -> str:
    """The shared customer inputs, with the placeholder each one currently uses."""
    blocks = [
        f'  <input key="{g.key}" unit="{g.unit}">\n'
        f"    <label>{g.label}</label>\n"
        f"    <current-placeholder>{g.defaultValue:g}</current-placeholder>\n"
        f"    <notes>{g.notes}</notes>\n"
        f"  </input>"
        for g in library.globalInputs
    ]
    return "<shared-inputs>\n" + "\n".join(blocks) + "\n</shared-inputs>"


def render_overlap_rules(library: Library) -> str:
    """Driver pairs that would claim the same dollar twice.

    The library's own `guidance` prose goes in verbatim — it was written for
    exactly this decision and paraphrasing it would only lose detail.
    """
    if not library.overlapGroups:
        return "<overlap-rules />"

    blocks = [
        f'  <group label="{group.label}">\n'
        f"    <exclusive>{group.exclusive}</exclusive>\n"
        f"    <rules-out>{', '.join(group.conflictsWith)}</rules-out>\n"
        f"    <guidance>{group.guidance.strip()}</guidance>\n"
        f"  </group>"
        for group in library.overlapGroups
    ]
    return (
        "<overlap-rules>\n"
        "  Recommending the exclusive driver in a group rules out the others in\n"
        "  that group: they monetize the same improvement twice. Pick one side or\n"
        "  the other and let the guidance decide which. Drivers listed together\n"
        "  under rules-out do not conflict with each other.\n"
        + "\n".join(blocks)
        + "\n</overlap-rules>"
    )


INSTRUCTIONS = """\
<instructions>
You are helping a sales engineer build a defensible business case for a
security platform. You have been given the full catalog of value drivers this
team can present, and the transcript of a discovery call with a prospect.

Your job is to decide which drivers that conversation actually supports.

Recommending a driver:
- Recommend a driver only when the call gives real support for it. A driver
  that merely could apply to any company is not supported by this call.
- Restraint is the goal. Three well-evidenced drivers beat eight speculative
  ones — a rep who has to walk back a claim in front of a CFO loses the room.
- `evidence` must be a span copied VERBATIM from the transcript, word for word.
  Do not paraphrase, tidy up grammar, merge two lines, or invent a line. If you
  cannot quote it exactly, return an empty string for evidence.
- `rationale` is one sentence in your own words, linking the quote to the
  driver.
- `confidence` is high when the customer states the problem outright, medium
  when it is clearly implied, low when it is a reasonable inference.
- Honour the overlap rules. Recommending both sides of an overlap group double
  counts the same money.

Reading numbers off the call:
- Return a value in `global_values` only when the transcript states that number
  for that input. Copy it as stated.
- Never estimate, never derive, never convert, never round, and never carry a
  number over from the placeholder. A placeholder is what the rep already has;
  repeating it tells them nothing.
- The same verbatim rule applies to `evidence` here, and it is enforced harder:
  a proposed number whose quote cannot be found in the transcript is discarded
  entirely rather than shown without its source.
- If the call states no numbers, return an empty list. That is a normal answer.

Multiple calls in one transcript:
- The text you are given may be more than one call with the same prospect,
  joined together. A line starting with "## " marks where the next call
  begins and names the file it came from. Calls appear in chronological
  order — the call after a later "## " marker is more recent than the one
  before it.
- A "## " marker line is a label, never something the customer said. Do not
  quote it as evidence.
- Calls sometimes correct each other — a discovery call might say "about
  5,000 endpoints" and a later call says "turns out it's 8,200." When two
  calls state a different number for the same shared input, the later call
  is the correction: resolve it yourself and return only that one value, not
  both.

Language:
- The product is always "the Platform". What the customer runs today is
  "legacy tools" or "the current environment". Do not name any security vendor,
  including any the transcript itself names.

Do not attempt to compute value, savings, or return. The financial model is
deterministic and runs separately from you; your job is which drivers apply and
what the customer said, nothing further.
</instructions>"""


def build_system_prompt(library: Library) -> str:
    """The full instruction block, assembled from the library at request time.

    This is the driver-agnostic seam: the catalogs are rendered by iterating
    the parsed library, so a new driver in the YAML appears here on the next
    process start with no code change anywhere.
    """
    return "\n\n".join(
        [
            INSTRUCTIONS,
            render_driver_catalog(library),
            render_globals_catalog(library),
            render_overlap_rules(library),
        ]
    )


def build_user_message(transcript: str) -> str:
    """The volatile half of the request — everything that changes per call."""
    return (
        "<transcript>\n"
        f"{transcript.strip()}\n"
        "</transcript>\n\n"
        "Which value drivers does this transcript support?"
    )


# --- Quote verification ------------------------------------------------------

_SMART = str.maketrans(
    {
        "’": "'",
        "‘": "'",
        "“": '"',
        "”": '"',
        "–": "-",
        "—": "-",
        "…": "...",
        " ": " ",
    }
)


def normalize_for_match(text: str) -> str:
    """Fold the differences a model introduces without changing the words."""
    return " ".join(text.translate(_SMART).casefold().split())


def quote_appears(quote: str, transcript: str) -> bool:
    """Whether this quote is really in the transcript.

    Verbatim means verbatim, allowing only for whitespace, capitalization, and
    smart punctuation — the three things a model reliably normalizes. Anything
    looser would accept a paraphrase, which is the failure this check exists
    to catch.
    """
    needle = normalize_for_match(quote).strip(".,;:!?\"'- ")
    if len(needle) < MIN_QUOTE_CHARS:
        return False
    return needle in normalize_for_match(transcript)


def value_is_plausible(value: float, global_input: GlobalInput) -> bool:
    """Whether a proposed value is the right order of magnitude.

    The band is derived from the library's own default, so a shared input added
    later gets one for free. It is deliberately loose: it exists to catch a
    unit blunder (150 for a $150k salary), not to second-guess an unusual
    customer. The real check is the interface showing the current value and the
    proposed one side by side before the rep applies anything.
    """
    if not math.isfinite(value) or value <= 0:
        return False
    default = global_input.defaultValue
    if default <= 0:
        return True
    return default / SCALE_TOLERANCE <= value <= default * SCALE_TOLERANCE


# --- Sanitizing --------------------------------------------------------------


def sanitize_analysis(
    raw: RawAnalysis, library: Library, transcript: str
) -> TranscriptAnalysis:
    """Decide what the model is allowed to show the rep.

    Keeps or drops; never rewrites. Drivers and numbers are held to different
    standards on purpose. A recommendation is a suggestion the rep evaluates,
    so an unverifiable quote costs it its quote and its confidence but not its
    place. A shared-input value is a number the rep will have to defend, so an
    unverifiable quote costs it everything.

    Conflicting recommendations pass through untouched. Which drivers to
    present is the rep's judgment call, and the interface warns about overlap
    the same way it does for a selection made by hand.

    A transcript may hold more than one call, joined in chronological order.
    When the model returns two entries for the same driver id or shared-input
    key — most often because a later call restated or corrected an earlier
    one — the later entry wins. That is a backstop, not the primary defense:
    the prompt already tells the model to resolve a contradiction itself and
    return one value. Either way, the resolution is never silent — `discarded`
    always names both the value that was kept and the one that was dropped.
    """
    if not transcript.strip():
        raise TranscriptError("The transcript is empty.")

    drivers_by_id = library.drivers_by_id
    globals_by_key = library.globals_by_key
    discarded: list[str] = []

    suggestions_by_id: dict[str, DriverSuggestion] = {}
    for item in raw.recommendations:
        driver = drivers_by_id.get(item.driver_id)
        if driver is None:
            discarded.append(f"unknown driver {item.driver_id!r}")
            continue

        verified = quote_appears(item.evidence, transcript)
        if not verified:
            discarded.append(f"unverifiable quote for {item.driver_id!r}")

        suggestion = DriverSuggestion(
            driver_id=driver.id,
            name=driver.name,
            category=driver.category,
            confidence=item.confidence if verified else Confidence.LOW,
            evidence=item.evidence if verified else "",
            rationale=item.rationale,
            quote_verified=verified,
        )

        earlier = suggestions_by_id.get(driver.id)
        if earlier is not None:
            discarded.append(
                f"duplicate suggestion for {driver.id!r}: kept the later call's "
                f"evidence ({suggestion.confidence}), dropped the earlier one "
                f"({earlier.confidence})"
            )
        suggestions_by_id[driver.id] = suggestion

    suggestions = sorted(suggestions_by_id.values(), key=lambda s: CONFIDENCE_RANK[s.confidence])

    proposals_by_key: dict[str, GlobalProposal] = {}
    for value_item in raw.global_values:
        shared = globals_by_key.get(value_item.key)
        if shared is None:
            discarded.append(f"unknown shared input {value_item.key!r}")
            continue

        if not value_is_plausible(value_item.value, shared):
            discarded.append(f"implausible value for {value_item.key!r}")
            continue
        if not quote_appears(value_item.evidence, transcript):
            discarded.append(f"unsourced value for {value_item.key!r}")
            continue

        proposal = GlobalProposal(
            key=shared.key,
            label=shared.label,
            unit=shared.unit,
            value=value_item.value,
            current_default=shared.defaultValue,
            evidence=value_item.evidence,
            quote_verified=True,
        )

        earlier = proposals_by_key.get(shared.key)
        if earlier is not None:
            discarded.append(
                f"duplicate value for {shared.key!r}: kept {proposal.value:g} "
                f"(later call), dropped {earlier.value:g} (earlier call)"
            )
        proposals_by_key[shared.key] = proposal

    return TranscriptAnalysis(
        suggestions=suggestions,
        global_proposals=list(proposals_by_key.values()),
        discarded=discarded,
    )


# --- Credentials -------------------------------------------------------------


def require_api_key() -> str:
    """The one place this repository reads an environment variable.

    The deterministic core and every test in the suite run with no key at all,
    so "unset" is the normal state for most of this repo and a vague failure
    here would be genuinely confusing. Say which variable, and say that only
    this one feature needs it.
    """
    key = os.environ.get(API_KEY_VAR, "").strip()
    if not key:
        raise AnalysisUnavailable(
            f"{API_KEY_VAR} is not set. Transcript analysis is the only feature "
            "that needs it — the business case model runs without it."
        )
    return key
