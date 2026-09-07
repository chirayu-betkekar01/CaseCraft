"""Tests for the deterministic core and the value driver library.

These must pass with no API key and no network — that is the whole point of
keeping the math away from the LLM.
"""

from __future__ import annotations

import inspect
import re
from pathlib import Path

import pytest

from calculators import CALCULATORS, analyst_hourly_rate
from modeling import (
    LIBRARY_PATH,
    DriverError,
    aggregate,
    cash_flow_curve,
    compute_case,
    compute_driver,
    find_conflicts,
    load_library,
    payback_months,
    resolve_inputs,
)
from models import Category, DealBasics, DriverResult, Unit

ROOT = Path(__file__).parent.parent


@pytest.fixture(scope="module")
def library():
    return load_library()


@pytest.fixture(scope="module")
def by_id(library):
    return library.drivers_by_id


# --- Library acceptance criteria ---------------------------------------------


def test_library_parses_cleanly(library):
    assert library.globalInputs
    assert library.drivers


def test_exactly_twelve_drivers_split_four_per_category(library):
    assert len(library.drivers) == 12

    counts: dict[Category, int] = {}
    for driver in library.drivers:
        counts[driver.category] = counts.get(driver.category, 0) + 1

    assert counts == {
        Category.COST_SAVINGS: 4,
        Category.PRODUCTIVITY: 4,
        Category.RISK_REDUCTION: 4,
    }


def test_every_driver_is_fully_populated(library):
    for driver in library.drivers:
        assert driver.id and driver.name.strip()
        assert driver.shortDescription.strip()
        assert len(driver.narrative.split()) >= 25, f"{driver.id}: narrative too thin"
        assert driver.formula.display.strip()
        assert driver.formula.variables, f"{driver.id} has no variables"
        assert driver.outputUnit == "USD/year"
        assert driver.illustrativeExample.assumptions.strip()


def test_every_variable_documents_its_default(library):
    """Defaults are illustrative assumptions, so each has to say where it came from."""
    for driver in library.drivers:
        for variable in driver.formula.variables:
            assert variable.notes.strip(), f"{driver.id}.{variable.key} has no notes"
            assert variable.label.strip()


def test_all_six_global_inputs_are_defined_and_referenced(library):
    expected = {
        "endpointCount",
        "secOpsTeamSize",
        "avgLoadedAnalystSalary",
        "currentToolStackAnnualCost",
        "avgBreachCostBenchmark",
        "avgEmployeeHourlyCost",
    }
    assert set(library.globals_by_key) == expected

    referenced = {
        variable.global_key
        for driver in library.drivers
        for variable in driver.formula.variables
        if variable.global_key is not None
    }
    assert referenced == expected, f"global inputs never referenced: {expected - referenced}"


def test_globals_used_by_returns_only_referenced_inputs(library):
    """The interface collects what the selection needs, not the whole set."""
    assert [g.key for g in library.globals_used_by(["headcount-avoidance-automation"])] == [
        "secOpsTeamSize",
        "avgLoadedAnalystSalary",
    ]


def test_globals_used_by_preserves_library_order(library):
    """Order is the library's, not the selection's — the form stays stable."""
    forwards = library.globals_used_by(
        ["reduced-end-user-downtime", "tool-license-consolidation"]
    )
    backwards = library.globals_used_by(
        ["tool-license-consolidation", "reduced-end-user-downtime"]
    )
    assert [g.key for g in forwards] == [g.key for g in backwards]
    assert [g.key for g in forwards] == [
        "endpointCount",
        "currentToolStackAnnualCost",
        "avgEmployeeHourlyCost",
    ]


def test_a_driver_needing_no_shared_inputs_asks_for_none(library):
    assert library.globals_used_by(["cyber-insurance-premium-reduction"]) == []


def test_no_selection_needs_no_shared_inputs(library):
    assert library.globals_used_by([]) == []


def test_the_full_selection_needs_every_shared_input(library):
    needed = library.globals_used_by([d.id for d in library.drivers])
    assert len(needed) == len(library.globalInputs)


def test_global_sourced_variables_carry_no_duplicate_default(library):
    """One default per number: the global's. A second copy could go stale."""
    for driver in library.drivers:
        for variable in driver.formula.variables:
            if variable.global_key is not None:
                assert variable.defaultValue is None, f"{driver.id}.{variable.key}"


VENDOR_DENYLIST = [
    "sentinelone", "sentinel one", "crowdstrike", "crowd strike", "falcon",
    "microsoft", "defender", "palo alto", "cortex", "carbon black", "vmware",
    "sophos", "mcafee", "trellix", "symantec", "broadcom", "trend micro",
    "cylance", "blackberry", "cybereason", "huntress", "arctic wolf", "rapid7",
    "tenable", "qualys", "splunk", "elastic", "wiz", "fortinet", "check point",
    "kaspersky", "eset", "bitdefender", "malwarebytes", "deep instinct",
    "tanium", "cisco", "secureworks", "mandiant", "sumo logic", "datadog",
]

SCANNED_FILES = [
    "backend/value_drivers.yaml",
    "backend/calculators.py",
    "backend/modeling.py",
    "backend/models.py",
    "backend/api.py",
    "backend/transcript.py",
    "backend/transcript_client.py",
    "README.md",
    "ARCHITECTURE.md",
    "docs/value-driver-library.md",
    "docs/DEPLOYMENT.md",
    "frontend/src/lib/format.ts",
    # The sample call lives in this file. A demo transcript naming a real
    # vendor is exactly the leak this rule exists to stop, so the test file
    # gets scanned too.
    "tests/test_transcript.py",
]


@pytest.mark.parametrize("filename", SCANNED_FILES)
def test_no_vendor_names_anywhere(filename):
    """The library must read as written for any modern EDR/XDR-class vendor."""
    path = ROOT / filename
    assert path.exists(), f"{filename} is missing — the vendor scan must not silently skip files"

    text = path.read_text(encoding="utf-8").lower()
    hits = [name for name in VENDOR_DENYLIST if re.search(rf"\b{re.escape(name)}\b", text)]
    assert not hits, f"{filename} names real vendor(s): {hits}"


def test_illustrative_examples_are_correct(library):
    """Each worked example must equal the driver computed from its own defaults."""
    defaults = library.global_defaults()

    for driver in library.drivers:
        result = compute_driver(driver, global_values=defaults)
        stated = driver.illustrativeExample.calculatedValue
        assert round(result.annual_value) == stated, (
            f"{driver.id}: example says {stated:,.0f}, computes to {result.annual_value:,.2f}"
        )


def test_every_illustrative_example_is_positive(library):
    """A driver whose defaults produce zero or a negative has broken defaults."""
    for driver in library.drivers:
        assert driver.illustrativeExample.calculatedValue > 0, driver.id


# --- Library / code integrity ------------------------------------------------


def test_library_and_calculators_agree(library):
    """load_library() is the guardrail against YAML and code drifting apart."""
    assert set(library.drivers_by_id) == set(CALCULATORS)


def test_calculator_signature_matches_declared_variables(library):
    """A calculator is called with **resolved_inputs — the names must line up."""
    for driver_id, driver in library.drivers_by_id.items():
        params = set(inspect.signature(CALCULATORS[driver_id]).parameters)
        assert params == driver.variable_keys, f"{driver_id}: {params} != {driver.variable_keys}"


def test_display_formula_mentions_every_variable(library):
    """The rep-facing formula string has to actually show the inputs it uses."""
    for driver in library.drivers:
        display = driver.formula.display
        for variable in driver.formula.variables:
            assert variable.key in display, f"{driver.id}: {variable.key} missing from display formula"


def test_unknown_global_reference_is_rejected(tmp_path, library):
    broken = LIBRARY_PATH.read_text(encoding="utf-8").replace(
        'source: "globalInput:endpointCount"', 'source: "globalInput:deviceCount"', 1
    )
    path = tmp_path / "broken.yaml"
    path.write_text(broken, encoding="utf-8")

    with pytest.raises(DriverError, match="unknown globalInput"):
        load_library(path)


# --- Input resolution --------------------------------------------------------


def test_percent_variables_become_fractions(by_id, library):
    inputs = resolve_inputs(by_id["cyber-insurance-premium-reduction"], global_values=library.global_defaults())
    assert inputs["premiumReductionPercent"] == pytest.approx(0.07)  # 7 in YAML
    assert inputs["currentAnnualPremium"] == 350_000  # USD, untouched


def test_overrides_beat_globals_and_defaults(by_id, library):
    driver = by_id["headcount-avoidance-automation"]
    inputs = resolve_inputs(
        driver,
        overrides={"secOpsTeamSize": 20, "headcountGrowthAvoidedPercent": 25},
        global_values=library.global_defaults(),
    )
    assert inputs["secOpsTeamSize"] == 20
    assert inputs["headcountGrowthAvoidedPercent"] == pytest.approx(0.25)
    assert inputs["avgLoadedAnalystSalary"] == 150_000  # global default, not overridden


def test_global_values_flow_into_every_driver_that_references_them(by_id):
    driver = by_id["analyst-investigation-triage-savings"]
    inputs = resolve_inputs(driver, global_values={"avgLoadedAnalystSalary": 208_000})
    assert inputs["avgLoadedAnalystSalary"] == 208_000
    assert inputs["alertVolumePerYear"] == 6000  # driver default still applies


def test_unknown_input_raises(by_id):
    with pytest.raises(DriverError, match="unknown input"):
        resolve_inputs(by_id["cyber-insurance-premium-reduction"], overrides={"seats": 5})


# --- Per-driver math ---------------------------------------------------------


def test_analyst_hourly_rate_uses_2080_hours():
    assert analyst_hourly_rate(150_000) == pytest.approx(72.115384615)


def test_tool_license_consolidation(by_id, library):
    result = compute_driver(by_id["tool-license-consolidation"], global_values=library.global_defaults())
    assert result.annual_value == pytest.approx(450_000 - 280_000)


def test_data_ingestion_reduction_scales_with_endpoints(by_id):
    driver = by_id["data-ingestion-infrastructure-reduction"]
    small = compute_driver(driver, global_values={"endpointCount": 1000})
    large = compute_driver(driver, global_values={"endpointCount": 2000})
    # Only the ingestion term scales; the infrastructure term is flat.
    assert large.annual_value - small.annual_value == pytest.approx(1000 * 2.4 * 2.50)


def test_incident_response_retainer_avoidance(by_id):
    result = compute_driver(by_id["incident-response-retainer-avoidance"])
    assert result.annual_value == pytest.approx((3 - 1) * 85_000)


def test_analyst_investigation_triage_savings(by_id, library):
    result = compute_driver(
        by_id["analyst-investigation-triage-savings"], global_values=library.global_defaults()
    )
    # 0.9h saved x 6,000 alerts = 5,400 hours at $72.115/hr
    assert result.annual_value == pytest.approx(5400 * analyst_hourly_rate(150_000))


def test_false_positive_reduction_converts_minutes_to_hours(by_id, library):
    result = compute_driver(
        by_id["alert-fatigue-false-positive-reduction"], global_values=library.global_defaults()
    )
    hours = (24_000 - 7_200) * (8 / 60)
    assert result.annual_value == pytest.approx(hours * analyst_hourly_rate(150_000))


def test_headcount_avoidance(by_id, library):
    result = compute_driver(
        by_id["headcount-avoidance-automation"], global_values=library.global_defaults()
    )
    assert result.annual_value == pytest.approx(8 * 0.20 * 150_000)


def test_end_user_downtime_uses_the_employee_rate_not_the_analyst_rate(by_id, library):
    result = compute_driver(by_id["reduced-end-user-downtime"], global_values=library.global_defaults())
    incidents = 5000 * 0.09
    assert result.annual_value == pytest.approx((6 - 1) * incidents * 55)


def test_breach_expected_loss_reduction(by_id, library):
    result = compute_driver(
        by_id["breach-expected-loss-reduction"], global_values=library.global_defaults()
    )
    assert result.annual_value == pytest.approx(0.18 * 4_500_000 - 0.09 * 3_150_000)


def test_compliance_driver_sums_audit_hours_and_fine_exposure(by_id, library):
    result = compute_driver(
        by_id["compliance-audit-fine-avoidance"], global_values=library.global_defaults()
    )
    audit = 120 * 3 * analyst_hourly_rate(150_000)
    assert result.annual_value == pytest.approx(audit + 0.02 * 1_500_000)


def test_ransomware_driver(by_id):
    result = compute_driver(by_id["ransomware-interruption-avoidance"])
    assert result.annual_value == pytest.approx(0.06 * (1_200_000 + 12 * 150_000))


def test_breach_churn_avoidance(by_id):
    result = compute_driver(by_id["breach-churn-reputational-avoidance"])
    assert result.annual_value == pytest.approx((0.18 - 0.09) * 4000 * 0.035 * 9000)


def test_result_carries_narrative_context(by_id):
    result = compute_driver(by_id["ransomware-interruption-avoidance"])
    assert result.category is Category.RISK_REDUCTION
    assert "Platform" in result.narrative
    assert result.formula_display
    assert result.inputs_used["ransomwareIncidentProbabilityReduction"] == pytest.approx(0.06)


# --- Aggregation -------------------------------------------------------------


@pytest.fixture
def deal():
    return DealBasics(company_name="Northwind Manufacturing", annual_cost=280_000,
                      one_time_cost=60_000, term_years=3)


def test_aggregation_is_a_straight_sum(deal, library):
    selections = {"incident-response-retainer-avoidance": {}, "headcount-avoidance-automation": {}}
    metrics = compute_case(deal, selections, library)
    assert metrics.total_annual_value == pytest.approx(170_000 + 240_000)
    assert len(metrics.drivers) == 2


def test_value_rolls_up_by_category(deal, library):
    selections = {
        "incident-response-retainer-avoidance": {},   # Cost Savings
        "headcount-avoidance-automation": {},         # Productivity Gains
        "ransomware-interruption-avoidance": {},      # Risk Reduction
    }
    metrics = compute_case(deal, selections, library)
    assert metrics.value_by_category == {
        "Cost Savings": pytest.approx(170_000),
        "Productivity Gains": pytest.approx(240_000),
        "Risk Reduction": pytest.approx(180_000),
    }


def test_global_override_reaches_the_aggregate(deal, library):
    """Doubling the analyst salary doubles a salary-driven driver."""
    base = compute_case(deal, {"headcount-avoidance-automation": {}}, library)
    doubled = compute_case(
        deal, {"headcount-avoidance-automation": {}}, library,
        global_values={"avgLoadedAnalystSalary": 300_000},
    )
    assert doubled.total_annual_value == pytest.approx(base.total_annual_value * 2)


def test_term_totals_roi_and_payback(deal):
    results = [
        DriverResult(driver_id="a", name="A", category=Category.COST_SAVINGS,
                     annual_value=400_000, formula_display="x", narrative="n"),
    ]
    metrics = aggregate(deal, results)
    assert metrics.total_value == pytest.approx(1_200_000)
    assert metrics.tco == pytest.approx(280_000 * 3 + 60_000)  # 900,000
    assert metrics.net_value == pytest.approx(300_000)
    assert metrics.roi_pct == pytest.approx(300_000 / 900_000 * 100)
    # Up front: $340k recovered at $400k/12 per month.
    assert metrics.payback_months == pytest.approx(340_000 / (400_000 / 12))


def test_one_time_value_offsets_the_upfront_outlay(deal):
    results = [
        DriverResult(driver_id="a", name="A", category=Category.COST_SAVINGS,
                     annual_value=120_000, one_time_value=500_000,
                     formula_display="x", narrative="n"),
    ]
    metrics = aggregate(deal, results)
    assert metrics.total_one_time_value == pytest.approx(500_000)
    assert metrics.total_value == pytest.approx(120_000 * 3 + 500_000)
    assert metrics.payback_months == 0.0  # one-time value exceeds the $340k up front


def test_payback_is_none_when_drivers_produce_no_value(deal):
    metrics = aggregate(deal, [])
    assert metrics.total_annual_value == 0
    assert metrics.payback_months is None


def test_roi_is_none_for_a_zero_cost_deal():
    free = DealBasics(company_name="Northwind Manufacturing", annual_cost=0)
    results = [
        DriverResult(driver_id="a", name="A", category=Category.RISK_REDUCTION,
                     annual_value=50_000, formula_display="x", narrative="n"),
    ]
    assert aggregate(free, results).roi_pct is None


def test_unknown_driver_raises(deal, library):
    with pytest.raises(DriverError, match="Unknown driver"):
        compute_case(deal, {"teleportation-savings": {}}, library)


# --- Overlap groups ----------------------------------------------------------


def test_overlap_groups_reference_real_drivers(library):
    known = set(library.drivers_by_id)
    for group in library.overlapGroups:
        assert group.exclusive in known
        assert set(group.conflictsWith) <= known
        assert group.exclusive not in group.conflictsWith
        assert group.guidance.strip()


def test_clean_selection_has_no_conflicts(library):
    assert find_conflicts(library, ["tool-license-consolidation", "reduced-end-user-downtime"]) == []


def test_headcount_avoidance_conflicts_with_reclaimed_analyst_hours(library):
    conflicts = find_conflicts(
        library, ["headcount-avoidance-automation", "analyst-investigation-triage-savings"]
    )
    assert len(conflicts) == 1
    group_id, clashing = conflicts[0]
    assert group_id == "analyst-capacity"
    assert clashing == {"headcount-avoidance-automation", "analyst-investigation-triage-savings"}


def test_the_two_time_based_drivers_do_not_conflict_with_each_other(library):
    """One counts investigated alerts, the other counts alerts dismissed at triage."""
    assert find_conflicts(
        library,
        ["analyst-investigation-triage-savings", "alert-fatigue-false-positive-reduction"],
    ) == []


def test_expected_loss_conflicts_with_both_of_its_components(library):
    conflicts = find_conflicts(
        library,
        [
            "breach-expected-loss-reduction",
            "ransomware-interruption-avoidance",
            "breach-churn-reputational-avoidance",
        ],
    )
    assert len(conflicts) == 1
    assert conflicts[0][1] == {
        "breach-expected-loss-reduction",
        "ransomware-interruption-avoidance",
        "breach-churn-reputational-avoidance",
    }


def test_components_without_the_exclusive_driver_are_fine(library):
    assert find_conflicts(
        library, ["ransomware-interruption-avoidance", "breach-churn-reputational-avoidance"]
    ) == []


def test_selecting_all_twelve_flags_both_groups(library):
    assert len(find_conflicts(library, [d.id for d in library.drivers])) == 2


# --- Cash flow and payback ---------------------------------------------------


def test_cash_flow_curve_starts_at_the_upfront_outlay(deal):
    curve = cash_flow_curve(deal, total_annual_value=600_000)
    assert curve[0] == (0, -(280_000 + 60_000))
    assert len(curve) == 3 * 12 + 1


def test_cash_flow_curve_steps_down_at_each_renewal(deal):
    curve = dict(cash_flow_curve(deal, total_annual_value=600_000))
    monthly = 600_000 / 12
    # Month 12 bills year two, so the curve drops by the annual cost that month.
    assert curve[11] - curve[10] == pytest.approx(monthly)
    assert curve[12] - curve[11] == pytest.approx(monthly - 280_000)


def test_cash_flow_curve_does_not_bill_past_the_term(deal):
    curve = dict(cash_flow_curve(deal, total_annual_value=600_000))
    assert curve[36] - curve[35] == pytest.approx(600_000 / 12)  # no fourth-year bill


@pytest.mark.parametrize("annual", [600_000, 900_000, 2_230_073, 330_000])
def test_payback_agrees_with_the_curve_crossing(deal, annual):
    """The KPI tile and the chart must never disagree."""
    months = payback_months(deal, annual)
    curve = dict(cash_flow_curve(deal, annual))
    assert months is not None
    crossed = min(m for m, v in curve.items() if v >= 0)
    assert crossed - 1 <= months <= crossed


def test_payback_accounts_for_the_second_year_bill(deal):
    """A slow deal must not pay back on year-one cost alone."""
    annual = 330_000  # $27.5k/mo against $340k up front
    naive = 340_000 / (annual / 12)  # 12.4 months — just past the year-two renewal
    actual = payback_months(deal, annual)

    assert naive > 12
    assert actual == pytest.approx((340_000 + 280_000) / (annual / 12))  # 22.5 months
    assert actual > naive


def test_payback_at_the_very_end_of_the_term_still_counts(deal):
    """$25k/mo covers $900k of cost at exactly month 36 — the last month counts."""
    assert payback_months(deal, total_annual_value=300_000) == pytest.approx(36.0)


def test_a_deal_that_crosses_just_after_the_term_does_not_pay_back(deal):
    assert payback_months(deal, total_annual_value=299_000) is None


def test_payback_is_none_when_the_deal_never_catches_up(deal):
    assert payback_months(deal, total_annual_value=100_000) is None


def test_payback_is_zero_when_one_time_value_covers_the_upfront(deal):
    assert payback_months(deal, total_annual_value=50_000, total_one_time_value=500_000) == 0.0


def test_full_library_case_is_computable(deal, library):
    """Every driver at once, on defaults — the upper bound of the model."""
    metrics = compute_case(deal, {d.id: {} for d in library.drivers}, library)
    assert len(metrics.drivers) == 12
    assert metrics.total_annual_value == pytest.approx(
        sum(d.illustrativeExample.calculatedValue for d in library.drivers), rel=1e-4
    )
    assert metrics.payback_months is not None and metrics.payback_months < 12
