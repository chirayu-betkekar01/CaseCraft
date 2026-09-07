"""The deterministic core: load the driver library, resolve each driver's
inputs, run its calculator, aggregate into case metrics.

No LLM, no Streamlit, no network. Everything here has to be defensible on its
own — Claude only ever describes numbers this module produced.
"""

from __future__ import annotations

from pathlib import Path

import yaml

from calculators import CALCULATORS, Value
from models import (
    CaseMetrics,
    DealBasics,
    Driver,
    DriverResult,
    Library,
    Unit,
)

LIBRARY_PATH = Path(__file__).parent / "value_drivers.yaml"


class DriverError(ValueError):
    """Raised when a driver is unknown, mis-specified, or missing inputs."""


def load_library(path: Path | str = LIBRARY_PATH) -> Library:
    """Parse value_drivers.yaml and verify it lines up with the calculators.

    Fails loudly on drift in either direction: a driver in YAML with no
    function, or a function with no YAML entry. Also rejects a variable that
    points at a globalInput which does not exist.
    """
    raw = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    library = Library.model_validate(raw)

    ids = [d.id for d in library.drivers]
    if len(ids) != len(set(ids)):
        duplicates = sorted({i for i in ids if ids.count(i) > 1})
        raise DriverError(f"Duplicate driver id(s) in library: {duplicates}")

    in_yaml, registered = set(ids), set(CALCULATORS)
    if missing := in_yaml - registered:
        raise DriverError(f"Drivers with no calculator: {sorted(missing)}")
    if orphaned := registered - in_yaml:
        raise DriverError(f"Calculators with no driver in the library: {sorted(orphaned)}")

    known_globals = set(library.globals_by_key)
    for driver in library.drivers:
        for variable in driver.formula.variables:
            key = variable.global_key
            if key is not None and key not in known_globals:
                raise DriverError(f"{driver.id}.{variable.key}: unknown globalInput {key!r}")
            if key is None and variable.defaultValue is None:
                raise DriverError(f"{driver.id}.{variable.key}: driverInput needs a defaultValue")

    for group in library.overlapGroups:
        referenced = {group.exclusive} | set(group.conflictsWith)
        if unknown := referenced - in_yaml:
            raise DriverError(f"overlapGroup {group.id!r} references unknown driver(s): {sorted(unknown)}")

    return library


def find_conflicts(library: Library, selected: set[str] | list[str]) -> list[tuple[str, set[str]]]:
    """Overlap groups violated by this selection, as (group id, clashing drivers).

    Empty means the selection double-counts nothing.
    """
    selected = set(selected)
    return [
        (group.id, clashing)
        for group in library.overlapGroups
        if (clashing := group.conflicts_in(selected))
    ]


def resolve_inputs(
    driver: Driver,
    overrides: dict[str, float] | None = None,
    global_values: dict[str, float] | None = None,
) -> dict[str, float]:
    """Build the keyword arguments one calculator will be called with.

    Precedence per variable: an explicit override, then the globalInputs value
    for a globalInput-sourced variable, then the variable's own defaultValue.
    Percent-unit values are divided by 100 last, so callers always pass human
    terms (7 for 7%) and calculators always receive fractions.
    """
    overrides = overrides or {}
    global_values = global_values or {}

    if unknown := set(overrides) - driver.variable_keys:
        raise DriverError(f"{driver.id}: unknown input(s) {sorted(unknown)}")

    resolved: dict[str, float] = {}
    for variable in driver.formula.variables:
        global_key = variable.global_key

        if variable.key in overrides and overrides[variable.key] is not None:
            value = float(overrides[variable.key])
        elif global_key is not None and global_key in global_values:
            value = float(global_values[global_key])
        elif variable.defaultValue is not None:
            value = float(variable.defaultValue)
        else:
            raise DriverError(f"{driver.id}: no value available for {variable.key!r}")

        if variable.unit is Unit.PERCENT:
            value /= 100.0
        resolved[variable.key] = value

    return resolved


def compute_driver(
    driver: Driver,
    overrides: dict[str, float] | None = None,
    global_values: dict[str, float] | None = None,
) -> DriverResult:
    """Run one driver's calculator against the resolved inputs."""
    inputs = resolve_inputs(driver, overrides, global_values)
    outcome = CALCULATORS[driver.id](**inputs)
    result = outcome if isinstance(outcome, Value) else Value(annual=float(outcome))

    return DriverResult(
        driver_id=driver.id,
        name=driver.name,
        category=driver.category,
        annual_value=result.annual,
        one_time_value=result.one_time,
        formula_display=driver.formula.display,
        narrative=driver.narrative,
        inputs_used=inputs,
    )


def cash_flow_curve(
    deal: DealBasics,
    total_annual_value: float,
    total_one_time_value: float = 0.0,
) -> list[tuple[int, float]]:
    """Cumulative net cash position, month by month across the term.

    Cost is billed the way these deals actually are: implementation plus the
    first year up front at month 0, then each renewal at its anniversary — which
    is why the curve steps down once a year. Benefit accrues evenly.
    """
    monthly_benefit = total_annual_value / 12.0
    curve = []
    for month in range(deal.term_years * 12 + 1):
        years_billed = min(month // 12 + 1, deal.term_years)
        cost = deal.one_time_cost + deal.annual_cost * years_billed
        benefit = total_one_time_value + monthly_benefit * month
        curve.append((month, benefit - cost))
    return curve


def payback_months(
    deal: DealBasics,
    total_annual_value: float,
    total_one_time_value: float = 0.0,
) -> float | None:
    """When cumulative benefit first covers cumulative cost.

    Solved against the same annual billing steps as `cash_flow_curve`, so the
    headline number and the chart always agree. Returns 0.0 when one-time value
    already covers the up-front outlay, and None when the deal never pays back
    inside the term.
    """
    upfront = deal.one_time_cost + deal.annual_cost - total_one_time_value
    if upfront <= 0:
        return 0.0

    monthly_benefit = total_annual_value / 12.0
    if monthly_benefit <= 0:
        return None

    # Cost is flat within each billing year, so test each year's plateau in turn.
    # The bound is exclusive except in the final year: a crossing at exactly the
    # anniversary belongs to the renewal that lands the same month, but a crossing
    # at the very end of the term still counts — there is no further bill.
    for year in range(deal.term_years):
        cost_to_date = upfront + deal.annual_cost * year
        crossing = cost_to_date / monthly_benefit
        end_of_year = (year + 1) * 12
        last_year = year == deal.term_years - 1
        if crossing < end_of_year or (last_year and crossing == end_of_year):
            return crossing
    return None


def aggregate(deal: DealBasics, results: list[DriverResult]) -> CaseMetrics:
    """Roll driver results up into the metrics the case is built on."""
    total_annual = sum(r.annual_value for r in results)
    total_one_time = sum(r.one_time_value for r in results)

    by_category: dict[str, float] = {}
    for r in results:
        by_category[r.category] = by_category.get(r.category, 0.0) + r.annual_value

    total_value = total_annual * deal.term_years + total_one_time
    tco = deal.annual_cost * deal.term_years + deal.one_time_cost
    net_value = total_value - tco

    roi_pct = (net_value / tco * 100.0) if tco > 0 else None
    payback = payback_months(deal, total_annual, total_one_time)

    return CaseMetrics(
        drivers=results,
        total_annual_value=total_annual,
        total_one_time_value=total_one_time,
        value_by_category=by_category,
        annual_cost=deal.annual_cost,
        one_time_cost=deal.one_time_cost,
        term_years=deal.term_years,
        total_value=total_value,
        tco=tco,
        net_value=net_value,
        roi_pct=roi_pct,
        payback_months=payback,
    )


def compute_case(
    deal: DealBasics,
    selections: dict[str, dict[str, float]],
    library: Library | None = None,
    global_values: dict[str, float] | None = None,
) -> CaseMetrics:
    """Compute every selected driver and aggregate the result.

    `selections` maps driver id -> that driver's input overrides (may be empty,
    in which case the driver runs entirely on globalInputs and its defaults).
    `global_values` supplies the customer's answers to the shared inputs;
    anything omitted falls back to the library's global defaults.
    """
    library = library if library is not None else load_library()
    by_id = library.drivers_by_id

    if unknown := set(selections) - set(by_id):
        raise DriverError(f"Unknown driver(s): {sorted(unknown)}")

    merged_globals = library.global_defaults() | (global_values or {})

    results = [
        compute_driver(by_id[driver_id], overrides, merged_globals)
        for driver_id, overrides in selections.items()
    ]
    return aggregate(deal, results)
