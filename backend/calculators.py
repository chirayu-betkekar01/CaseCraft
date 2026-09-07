"""One small function per value driver, registered by driver id.

Each calculator receives already-resolved inputs as keyword arguments — global
inputs merged in, defaults filled, percents converted to fractions — and returns
either a bare float (annual USD) or a Value for a driver with a one-time
component. Parameter names must match the driver's formula.variables keys
exactly; a test enforces that.

Adding a driver means: a YAML entry in value_drivers.yaml AND a function here
with a matching id. load_library() fails loudly if the two drift apart.

Vendor-neutral by design: the product is "the Platform", the prior state is
"legacy tools" or "the current environment".
"""

from __future__ import annotations

from collections.abc import Callable
from typing import NamedTuple

ANALYST_HOURS_PER_YEAR = 2080
"""Productive hours per analyst per year, used to derive an hourly loaded rate
from an annual salary."""

MINUTES_PER_HOUR = 60


class Value(NamedTuple):
    """Annual USD, plus an optional one-time amount."""

    annual: float
    one_time: float = 0.0


Calculator = Callable[..., float | Value]

CALCULATORS: dict[str, Calculator] = {}


def calculator(driver_id: str) -> Callable[[Calculator], Calculator]:
    """Register a function as the math for one driver id."""

    def register(fn: Calculator) -> Calculator:
        if driver_id in CALCULATORS:
            raise ValueError(f"Duplicate calculator registered for {driver_id!r}")
        CALCULATORS[driver_id] = fn
        return fn

    return register


def analyst_hourly_rate(avg_loaded_analyst_salary: float) -> float:
    """Loaded annual salary → hourly rate."""
    return avg_loaded_analyst_salary / ANALYST_HOURS_PER_YEAR


# --- Cost Savings ------------------------------------------------------------


@calculator("tool-license-consolidation")
def tool_license_consolidation(
    currentToolStackAnnualCost: float,
    newPlatformAnnualCost: float,
) -> float:
    """Overlapping legacy license spend eliminated, net of the Platform's cost."""
    return currentToolStackAnnualCost - newPlatformAnnualCost


@calculator("data-ingestion-infrastructure-reduction")
def data_ingestion_infrastructure_reduction(
    endpointCount: float,
    dataVolumeReductionGBPerEndpoint: float,
    siemCostPerGB: float,
    infrastructureCostAvoided: float,
) -> float:
    """Lower SIEM ingestion volume plus retired legacy infrastructure."""
    ingestion_saving = endpointCount * dataVolumeReductionGBPerEndpoint * siemCostPerGB
    return ingestion_saving + infrastructureCostAvoided


@calculator("cyber-insurance-premium-reduction")
def cyber_insurance_premium_reduction(
    currentAnnualPremium: float,
    premiumReductionPercent: float,
) -> float:
    """Premium discount earned by evidencing modern endpoint controls."""
    return currentAnnualPremium * premiumReductionPercent


@calculator("incident-response-retainer-avoidance")
def incident_response_retainer_avoidance(
    externalIREngagementsPerYearBefore: float,
    externalIREngagementsPerYearAfter: float,
    avgIREngagementCost: float,
) -> float:
    """External IR/forensics engagements no longer triggered."""
    engagements_avoided = externalIREngagementsPerYearBefore - externalIREngagementsPerYearAfter
    return engagements_avoided * avgIREngagementCost


# --- Productivity Gains ------------------------------------------------------


@calculator("analyst-investigation-triage-savings")
def analyst_investigation_triage_savings(
    avgInvestigationHoursBefore: float,
    avgInvestigationHoursAfter: float,
    alertVolumePerYear: float,
    avgLoadedAnalystSalary: float,
) -> float:
    """Analyst hours reclaimed across the year's investigated alerts."""
    hours_saved = (avgInvestigationHoursBefore - avgInvestigationHoursAfter) * alertVolumePerYear
    return hours_saved * analyst_hourly_rate(avgLoadedAnalystSalary)


@calculator("alert-fatigue-false-positive-reduction")
def alert_fatigue_false_positive_reduction(
    falsePositiveVolumeBefore: float,
    falsePositiveVolumeAfter: float,
    avgTriageMinutesPerAlert: float,
    avgLoadedAnalystSalary: float,
) -> float:
    """Analyst hours reclaimed from triaging noise."""
    alerts_avoided = falsePositiveVolumeBefore - falsePositiveVolumeAfter
    hours_saved = alerts_avoided * (avgTriageMinutesPerAlert / MINUTES_PER_HOUR)
    return hours_saved * analyst_hourly_rate(avgLoadedAnalystSalary)


@calculator("headcount-avoidance-automation")
def headcount_avoidance_automation(
    secOpsTeamSize: float,
    headcountGrowthAvoidedPercent: float,
    avgLoadedAnalystSalary: float,
) -> float:
    """Hires deferred because the existing team absorbs the added volume."""
    ftes_avoided = secOpsTeamSize * headcountGrowthAvoidedPercent
    return ftes_avoided * avgLoadedAnalystSalary


@calculator("reduced-end-user-downtime")
def reduced_end_user_downtime(
    avgDeviceDowntimeHoursBefore: float,
    avgDeviceDowntimeHoursAfter: float,
    endpointCount: float,
    annualRemediationIncidentRatePercent: float,
    avgEmployeeHourlyCost: float,
) -> float:
    """Working hours returned to employees whose devices are remediated faster."""
    incidents = endpointCount * annualRemediationIncidentRatePercent
    hours_saved = (avgDeviceDowntimeHoursBefore - avgDeviceDowntimeHoursAfter) * incidents
    return hours_saved * avgEmployeeHourlyCost


# --- Risk Reduction ----------------------------------------------------------


@calculator("breach-expected-loss-reduction")
def breach_expected_loss_reduction(
    annualBreachProbabilityBefore: float,
    annualBreachProbabilityAfter: float,
    avgBreachCostBenchmark: float,
    avgBreachCostAfter: float,
) -> float:
    """Reduction in expected annual loss: probability x impact, before less after."""
    expected_before = annualBreachProbabilityBefore * avgBreachCostBenchmark
    expected_after = annualBreachProbabilityAfter * avgBreachCostAfter
    return expected_before - expected_after


@calculator("compliance-audit-fine-avoidance")
def compliance_audit_fine_avoidance(
    auditPrepHoursSavedPerAudit: float,
    numberOfAuditsPerYear: float,
    avgLoadedAnalystSalary: float,
    fineProbabilityReductionPercent: float,
    avgRegulatoryFineExposure: float,
) -> float:
    """Audit preparation hours saved, plus risk-adjusted fine exposure avoided."""
    prep_hours = auditPrepHoursSavedPerAudit * numberOfAuditsPerYear
    audit_saving = prep_hours * analyst_hourly_rate(avgLoadedAnalystSalary)
    fine_saving = fineProbabilityReductionPercent * avgRegulatoryFineExposure
    return audit_saving + fine_saving


@calculator("ransomware-interruption-avoidance")
def ransomware_interruption_avoidance(
    ransomwareIncidentProbabilityReduction: float,
    avgRansomPaymentAvoided: float,
    avgBusinessInterruptionDays: float,
    avgDailyRevenueImpact: float,
) -> float:
    """Risk-adjusted ransom payment and business interruption avoided."""
    event_cost = avgRansomPaymentAvoided + (avgBusinessInterruptionDays * avgDailyRevenueImpact)
    return ransomwareIncidentProbabilityReduction * event_cost


@calculator("breach-churn-reputational-avoidance")
def breach_churn_reputational_avoidance(
    annualBreachProbabilityBefore: float,
    annualBreachProbabilityAfter: float,
    affectedCustomerBase: float,
    postBreachChurnRate: float,
    avgCustomerLifetimeValue: float,
) -> float:
    """Customer lifetime value retained by avoiding a disclosed breach."""
    probability_reduction = annualBreachProbabilityBefore - annualBreachProbabilityAfter
    customers_retained = probability_reduction * affectedCustomerBase * postBreachChurnRate
    return customers_retained * avgCustomerLifetimeValue
