import { pdf } from "@react-pdf/renderer";
import { useMemo, useState } from "react";
import { CashFlowChart } from "../components/CashFlowChart";
import { ConflictNotice } from "../components/ConflictNotice";
import { ContributionChart } from "../components/ContributionChart";
import { NumberField } from "../components/NumberField";
import { driverInputsOf, findConflicts, globalsUsedBy } from "../lib/conflicts";
import { compactMoney, money, months, percent } from "../lib/format";
import {
  CATEGORIES, CATEGORY_HUE,
  type CaseMetrics, type CaseResponse, type Deal, type Library, type Selections,
} from "../lib/types";
import { BusinessCaseDocument } from "../pdf/BusinessCaseDocument";

/**
 * Generates the PDF only on click, never on every recompute — matching the
 * same "expensive work runs once, on an explicit action" rule the transcript
 * feature already follows, just applied to a rendering cost instead of an
 * LLM call. Deliberately not react-pdf's PDFDownloadLink, which would
 * regenerate continuously as metrics changes on every keystroke via the
 * 90ms-debounced recompute already running above this view.
 */
async function exportPdf(
  deal: Deal,
  metrics: CaseMetrics,
  cashFlow: { month: number; net: number }[],
): Promise<void> {
  const blob = await pdf(BusinessCaseDocument({ deal, metrics, cashFlow })).toBlob();
  const url = URL.createObjectURL(blob);
  const slug = deal.companyName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${slug || "business-case"}-business-case.pdf`;
  anchor.click();
  URL.revokeObjectURL(url);
}

const NARRATIVE_SECTIONS = [
  "Executive summary",
  "The current environment",
  "What changes with the Platform",
  "The financial case",
  "Recommended next steps",
];

interface Props {
  library: Library;
  deal: Deal;
  selected: Set<string>;
  selections: Selections;
  globalValues: Record<string, number>;
  result: CaseResponse | null;
  stale: boolean;
  elapsedMs: number | null;
  onGlobalChange: (key: string, value: number) => void;
  onOverrideChange: (driverId: string, key: string, value: number) => void;
  onBack: () => void;
}

export function CaseView({
  library, deal, selected, selections, globalValues,
  result, stale, elapsedMs, onGlobalChange, onOverrideChange, onBack,
}: Props) {
  const conflicts = useMemo(() => findConflicts(library, selected), [library, selected]);
  const needed = useMemo(() => globalsUsedBy(library, selected), [library, selected]);
  const byId = useMemo(() => new Map(library.drivers.map((d) => [d.id, d])), [library]);
  const [open, setOpen] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  if (!result) return <div className="loading">Computing…</div>;

  const { metrics, cashFlow } = result;
  const valueFor = (id: string) =>
    metrics.drivers.find((d) => d.driverId === id)?.annualValue ?? 0;

  return (
    <div className="container container--wide">
      <div className="case">
        <aside className="panel">
          <div className="panel__title">
            <h2>Adjust</h2>
            <span className="panel__note">recomputes locally</span>
          </div>

          {needed.length > 0 && (
            <div className="accordion" data-open={open === "__globals" ? "true" : "false"}>
              <button className="accordion__head" onClick={() => setOpen(open === "__globals" ? null : "__globals")}>
                <Chevron />
                <span className="accordion__name">About the customer</span>
                <span className="accordion__value">{needed.length}</span>
              </button>
              {open === "__globals" && (
                <div className="accordion__body">
                  {needed.map((input) => (
                    <NumberField
                      key={input.key}
                      id={`panel-global-${input.key}`}
                      label={input.label}
                      unit={input.unit}
                      value={globalValues[input.key] ?? input.defaultValue}
                      onChange={(value) => onGlobalChange(input.key, value)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {[...selected].map((id) => byId.get(id)).filter((d) => d !== undefined).map((driver) => {
            const isOpen = open === driver.id;
            const inputs = driverInputsOf(driver);
            return (
              <div className="accordion" key={driver.id} data-open={isOpen ? "true" : "false"}>
                <button className="accordion__head" onClick={() => setOpen(isOpen ? null : driver.id)}>
                  <Chevron />
                  <span className="accordion__name">{driver.name}</span>
                  <span className="accordion__value">{compactMoney(valueFor(driver.id))}</span>
                </button>
                {isOpen && (
                  <div className="accordion__body">
                    {inputs.map((variable) => (
                      <NumberField
                        key={variable.key}
                        id={`panel-${driver.id}-${variable.key}`}
                        label={variable.label}
                        unit={variable.unit}
                        value={
                          selections[driver.id]?.[variable.key] ?? variable.defaultValue ?? 0
                        }
                        onChange={(value) => onOverrideChange(driver.id, variable.key, value)}
                      />
                    ))}
                    <div className="accordion__formula">{driver.formula.display}</div>
                  </div>
                )}
              </div>
            );
          })}
        </aside>

        <main>
          <header className="case-head">
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1>{deal.companyName}</h1>
              <div className="chips">
                <span className="chip">{metrics.drivers.length} drivers</span>
                <span className="chip">{money(deal.annualCost)}/yr</span>
                <span className="chip">{deal.termYears}-year term</span>
                <span className="chip chip--live">
                  {elapsedMs === null ? "local compute" : `${elapsedMs.toFixed(0)} ms · 0 API calls to Claude`}
                </span>
              </div>
            </div>
            <div className="case-head__actions">
              <button
                className="btn"
                onClick={() => {
                  setExporting(true);
                  exportPdf(deal, metrics, cashFlow).finally(() => setExporting(false));
                }}
                disabled={exporting}
              >
                {exporting ? "Generating…" : "Export PDF"}
              </button>
              <button className="btn" onClick={onBack}>← Edit deal &amp; drivers</button>
            </div>
          </header>

          {conflicts.length > 0 && (
            <div style={{ marginBottom: 18 }}>
              <ConflictNotice conflicts={conflicts} />
            </div>
          )}

          <div className={stale ? "is-stale" : undefined}>
            <div className="kpis">
              <div className="stat stat--hero">
                <div className="stat__label">Total annual value</div>
                <div className="stat__value">{money(metrics.totalAnnualValue)}</div>
                <div className="stat__meta">across {metrics.drivers.length} value drivers</div>
              </div>
              <div className="stat">
                <div className="stat__label">{metrics.termYears}-year net</div>
                <div className="stat__value">{money(metrics.netValue)}</div>
                <div className={metrics.roiPct !== null && metrics.roiPct > 0
                  ? "stat__meta stat__meta--good" : "stat__meta"}>
                  {metrics.roiPct === null ? "no cost modeled" : `${percent(metrics.roiPct)} ROI`}
                </div>
              </div>
              <div className="stat">
                <div className="stat__label">Payback</div>
                <div className="stat__value">{months(metrics.paybackMonths, metrics.termYears)}</div>
                <div className="stat__meta">
                  {money(deal.annualCost + deal.oneTimeCost)} up front
                </div>
              </div>
              <div className="stat">
                <div className="stat__label">{metrics.termYears}-year TCO</div>
                <div className="stat__value">{money(metrics.tco)}</div>
                <div className="stat__meta">
                  vs {money(metrics.totalValue)} of value
                </div>
              </div>
            </div>

            <div className="charts">
              <section className="chart-card">
                <div className="chart-card__head">
                  <div className="chart-card__title">Where the value comes from</div>
                  <div className="legend">
                    {CATEGORIES.map((category) => (
                      <span className="legend__item" key={category}>
                        <span className="legend__swatch"
                              style={{ background: CATEGORY_HUE[category] }} />
                        {category}
                      </span>
                    ))}
                  </div>
                </div>
                <ContributionChart drivers={metrics.drivers} />
              </section>

              <section className="chart-card">
                <div className="chart-card__head">
                  <div className="chart-card__title">Cumulative net position</div>
                </div>
                <CashFlowChart points={cashFlow} paybackMonths={metrics.paybackMonths}
                               termYears={metrics.termYears} />
                <p className="chart-card__note">
                  Implementation and the first year bill up front; each renewal bills at its
                  anniversary, which is what steps the curve down once a year.
                </p>
              </section>
            </div>

            <section className="section-card">
              <div className="section-card__head">
                <h2>Driver breakdown</h2>
                <span className="panel__note">
                  {CATEGORIES.filter((c) => metrics.valueByCategory[c])
                    .map((c) => `${c}: ${compactMoney(metrics.valueByCategory[c] ?? 0)}`)
                    .join("  ·  ")}
                </span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Driver</th>
                      <th className="num">Annual value</th>
                      <th className="num">{metrics.termYears}-year value</th>
                      <th>Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...metrics.drivers]
                      .sort((a, b) => b.annualValue - a.annualValue)
                      .map((driver) => {
                        const share = metrics.totalAnnualValue
                          ? driver.annualValue / metrics.totalAnnualValue : 0;
                        return (
                          <tr key={driver.driverId}>
                            <td className="td--name">
                              <span className="cat-dot"
                                    style={{ background: CATEGORY_HUE[driver.category] }} />
                              {driver.name}
                            </td>
                            <td className="num">{money(driver.annualValue)}</td>
                            <td className="num">
                              {money(driver.annualValue * metrics.termYears + driver.oneTimeValue)}
                            </td>
                            <td>
                              <span className="share-track">
                                <span className="share-fill"
                                      style={{
                                        width: `${(share * 100).toFixed(1)}%`,
                                        background: CATEGORY_HUE[driver.category],
                                      }} />
                              </span>
                              {(share * 100).toFixed(1)}%
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="section-card">
              <div className="section-card__head">
                <h2>Narrative</h2>
                <span className="panel__note">Module 4</span>
              </div>
              <div style={{ borderTop: "1px solid var(--border)" }}>
                {NARRATIVE_SECTIONS.map((section) => (
                  <div className="narrative__section" key={section}>
                    <div className="narrative__heading">{section}</div>
                    <div className="narrative__pending">
                      Pending — Claude will receive the metrics above as fixed facts and write
                      this section around them. It never computes a number.
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}

function Chevron() {
  return (
    <span className="accordion__chevron" aria-hidden="true">
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
        <path d="M4.2 2.4 8.1 6l-3.9 3.6" stroke="currentColor" strokeWidth="1.5"
              strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
