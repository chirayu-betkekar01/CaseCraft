"""Typed shapes for the value driver library and the computed case.

The library schema follows the value driver library brief: a `globalInputs`
section of shared customer variables, plus a `drivers` array where each driver
is self-contained (formula, variables, defaults, worked example).

Nothing here touches Claude or Streamlit — these are the contracts the
deterministic core is built on.
"""

from __future__ import annotations

import re
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel

WIRE = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")
"""Serialization config for the models that cross the API boundary.

Python keeps snake_case internally; JSON gets camelCase. The library models are
already camelCase by the driver brief, so this only applies to the deal and the
computed case.
"""

GLOBAL_SOURCE = re.compile(r"^globalInput:(?P<key>\w+)$")
DRIVER_SOURCE = "driverInput"


class Category(StrEnum):
    COST_SAVINGS = "Cost Savings"
    PRODUCTIVITY = "Productivity Gains"
    RISK_REDUCTION = "Risk Reduction"


class Confidence(StrEnum):
    """How strongly a transcript supports a driver.

    Three levels, not a 0-100 score: a numeric relevance score would be a
    number Claude invented, and false precision is exactly what the
    "Claude never invents numbers" rule exists to prevent.
    """

    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class Unit(StrEnum):
    """Units a variable can carry.

    PERCENT is written in human terms (7 means 7%) and normalized to a
    fraction (0.07) before it ever reaches a calculator.
    """

    COUNT = "count"
    USD = "USD"
    USD_PER_YEAR = "USD/year"
    USD_PER_HOUR = "USD/hour"
    USD_PER_GB = "USD/GB"
    HOURS = "hours"
    MINUTES = "minutes"
    DAYS = "days"
    GB = "GB"
    FTE = "FTE"
    PERCENT = "percent"


class GlobalInput(BaseModel):
    """A customer variable shared across drivers — collected once."""

    model_config = ConfigDict(extra="forbid")

    key: str
    label: str
    unit: Unit
    defaultValue: float
    notes: str


class Variable(BaseModel):
    """One input to a driver's formula.

    `source` is either "globalInput:<key>" — in which case the value comes
    from globalInputs and `defaultValue` is intentionally absent so there is
    only ever one default for that number — or "driverInput", which must
    carry its own `defaultValue`.
    """

    model_config = ConfigDict(extra="forbid")

    key: str
    label: str
    unit: Unit
    source: str
    defaultValue: float | None = None
    notes: str

    @field_validator("source")
    @classmethod
    def _known_source(cls, value: str) -> str:
        if value != DRIVER_SOURCE and not GLOBAL_SOURCE.match(value):
            raise ValueError(f"source must be {DRIVER_SOURCE!r} or 'globalInput:<key>', got {value!r}")
        return value

    @property
    def global_key(self) -> str | None:
        """The globalInputs key this variable reads, or None if driver-specific."""
        match = GLOBAL_SOURCE.match(self.source)
        return match.group("key") if match else None


class Formula(BaseModel):
    model_config = ConfigDict(extra="forbid")

    display: str
    """Human-readable formula shown to the rep. Never evaluated — the
    registered function in calculators.py is the source of truth."""

    variables: list[Variable]


class IllustrativeExample(BaseModel):
    model_config = ConfigDict(extra="forbid")

    assumptions: str
    calculatedValue: float
    """Must equal the driver computed from its own stated defaults, to the
    nearest dollar. Enforced by test_illustrative_examples_are_correct."""


class Driver(BaseModel):
    """A value driver as defined in value_drivers.yaml."""

    model_config = ConfigDict(extra="forbid")

    id: str
    category: Category
    name: str
    shortDescription: str
    narrative: str
    formula: Formula
    outputUnit: str = "USD/year"
    illustrativeExample: IllustrativeExample

    @property
    def variable_keys(self) -> set[str]:
        return {v.key for v in self.formula.variables}


class OverlapGroup(BaseModel):
    """Drivers that would claim the same dollar if presented together.

    `exclusive` is the driver that subsumes the others: selecting it alongside
    anything in `conflictsWith` double-counts. Drivers inside `conflictsWith`
    do not conflict with each other.
    """

    model_config = ConfigDict(extra="forbid")

    id: str
    label: str
    exclusive: str
    conflictsWith: list[str]
    guidance: str

    def conflicts_in(self, selected: set[str]) -> set[str]:
        """Which selected drivers clash, or an empty set if the picks are clean."""
        if self.exclusive not in selected:
            return set()
        clashing = selected & set(self.conflictsWith)
        return ({self.exclusive} | clashing) if clashing else set()


class Library(BaseModel):
    """The parsed value_drivers.yaml."""

    model_config = ConfigDict(extra="forbid")

    globalInputs: list[GlobalInput]
    drivers: list[Driver]
    overlapGroups: list[OverlapGroup] = Field(default_factory=list)

    @property
    def globals_by_key(self) -> dict[str, GlobalInput]:
        return {g.key: g for g in self.globalInputs}

    @property
    def drivers_by_id(self) -> dict[str, Driver]:
        return {d.id: d for d in self.drivers}

    def global_defaults(self) -> dict[str, float]:
        return {g.key: g.defaultValue for g in self.globalInputs}

    def globals_used_by(self, driver_ids: set[str] | list[str]) -> list[GlobalInput]:
        """The shared inputs these drivers actually reference, in library order.

        Asking a rep for an analyst salary when nothing they picked uses it is
        noise, so the interface only collects what the selection needs.
        """
        wanted = set(driver_ids)
        used = {
            variable.global_key
            for driver in self.drivers
            if driver.id in wanted
            for variable in driver.formula.variables
            if variable.global_key is not None
        }
        return [g for g in self.globalInputs if g.key in used]


# --- Computed output ---------------------------------------------------------


class DriverResult(BaseModel):
    """What one driver contributed, with everything the narrative needs."""

    model_config = WIRE

    driver_id: str
    name: str
    category: Category
    annual_value: float
    one_time_value: float = 0.0
    formula_display: str
    narrative: str
    inputs_used: dict[str, float] = Field(default_factory=dict)


class DealBasics(BaseModel):
    """The commercial side of the deal — what the customer pays."""

    model_config = WIRE

    company_name: str
    domain: str | None = None
    annual_cost: float = Field(ge=0, description="Annual Platform subscription cost")
    one_time_cost: float = Field(default=0.0, ge=0, description="Implementation / services")
    term_years: int = Field(default=3, ge=1, le=10)


class CaseMetrics(BaseModel):
    """The full deterministic output. Claude receives this as fixed facts."""

    model_config = WIRE

    drivers: list[DriverResult]

    total_annual_value: float
    total_one_time_value: float
    value_by_category: dict[str, float]

    annual_cost: float
    one_time_cost: float
    term_years: int

    total_value: float
    """Gross value over the term."""

    tco: float
    """Total cost of ownership over the term."""

    net_value: float
    roi_pct: float | None
    payback_months: float | None
    """None when the deal never pays back inside the term — either because the
    drivers produce no value, or because cumulative benefit never catches
    cumulative cost. 0.0 when one-time value already covers the up-front outlay."""


# --- Transcript analysis -----------------------------------------------------
# What the rep is shown after a call transcript is analyzed. Every field the
# library already knows — name, category, label, unit, the current default — is
# filled in server-side from the library rather than read back from the model,
# so the library stays the single source of truth for its own facts.


class DriverSuggestion(BaseModel):
    """One driver the transcript supports, with the line that supports it."""

    model_config = WIRE

    driver_id: str
    name: str
    category: Category
    confidence: Confidence
    evidence: str
    """The rep's own words, verbatim from the transcript. Empty when the quote
    could not be found in the transcript — a quote is never reconstructed."""

    rationale: str
    quote_verified: bool


class GlobalProposal(BaseModel):
    """A shared input the transcript stated a value for. Never auto-applied.

    Held to a stricter standard than a suggestion: a suggestion is something
    the rep evaluates, but a number is something the rep has to defend. A value
    whose stated source cannot be found in the transcript is dropped outright
    rather than shown without it, so `quote_verified` is always True here.
    """

    model_config = WIRE

    key: str
    label: str
    unit: Unit
    value: float
    current_default: float
    evidence: str
    quote_verified: bool


class TranscriptAnalysis(BaseModel):
    """The sanitized result of one transcript analysis."""

    model_config = WIRE

    suggestions: list[DriverSuggestion]
    global_proposals: list[GlobalProposal]
    discarded: list[str] = Field(
        default_factory=list,
        description="Everything dropped on the way through, so the filtering is visible rather than silent.",
    )
