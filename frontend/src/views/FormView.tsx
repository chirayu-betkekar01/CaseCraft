import { useMemo } from "react";
import { DriverTile } from "../components/DriverTile";
import { ConflictNotice } from "../components/ConflictNotice";
import { NumberField, TextField } from "../components/NumberField";
import { TranscriptCard } from "../components/TranscriptCard";
import { findConflicts, globalsUsedBy } from "../lib/conflicts";
import { unacceptedSuggestions, type AttachedFile } from "../lib/transcript";
import {
  CATEGORIES,
  CATEGORY_HUE,
  type Deal,
  type Library,
  type TranscriptAnalysis,
} from "../lib/types";

interface Props {
  library: Library;
  deal: Deal;
  onDealChange: (deal: Deal) => void;
  selected: Set<string>;
  onToggle: (id: string) => void;
  globalValues: Record<string, number>;
  onGlobalChange: (key: string, value: number) => void;
  transcriptNotes: string;
  onTranscriptNotesChange: (text: string) => void;
  transcriptFiles: AttachedFile[];
  onAddTranscriptFiles: (files: AttachedFile[]) => void;
  onRemoveTranscriptFile: (id: string) => void;
  analysis: TranscriptAnalysis | null;
  analyzing: boolean;
  analysisError: string | null;
  resolvedProposals: Set<string>;
  onAnalyze: (text: string) => void;
  onAcceptSuggestion: (driverId: string) => void;
  onAcceptAllSuggestions: (driverIds: string[]) => void;
  onApplyProposal: (key: string, value: number) => void;
  onDismissProposal: (key: string) => void;
  onSubmit: () => void;
}

function CardHead({ step, title, caption }: { step: number; title: string; caption?: string }) {
  return (
    <div className="card__head">
      <span className="card__step">{step}</span>
      <div>
        <div className="card__title">{title}</div>
        {caption && <div className="card__caption">{caption}</div>}
      </div>
    </div>
  );
}

export function FormView({
  library, deal, onDealChange, selected, onToggle,
  globalValues, onGlobalChange, transcriptNotes, onTranscriptNotesChange,
  transcriptFiles, onAddTranscriptFiles, onRemoveTranscriptFile,
  analysis, analyzing, analysisError, resolvedProposals, onAnalyze,
  onAcceptSuggestion, onAcceptAllSuggestions, onApplyProposal, onDismissProposal,
  onSubmit,
}: Props) {
  const conflicts = useMemo(() => findConflicts(library, selected), [library, selected]);
  const needed = useMemo(() => globalsUsedBy(library, selected), [library, selected]);
  const outstanding = analysis
    ? unacceptedSuggestions(analysis.suggestions, selected).length
    : 0;
  const hasCompany = deal.companyName.trim().length > 0;
  const canSubmit = hasCompany && selected.size > 0;
  const set = <K extends keyof Deal>(key: K, value: Deal[K]) =>
    onDealChange({ ...deal, [key]: value });

  return (
    <>
      <div className="container">
        <header className="hero">
          <div className="hero__brand">CaseCraft</div>
          <h1>
            Build the Business Case <em>before</em> it stalls
          </h1>
        </header>
      </div>

      <div className="container">
        <section className="card">
          <div className="card__head">
            <div>
              <div className="card__title">How it works</div>
              <div className="card__caption">
                Five steps from a deal to a defensible, numbers-first business case.
              </div>
            </div>
          </div>
          <div className="card__body">
            <ol className="howto__steps">
              <li>
                <strong>Enter the deal basics.</strong> Company, the Platform's annual cost,
                one-time implementation, and term.
              </li>
              <li>
                <strong>Bring a call, optionally.</strong> Paste notes or upload a transcript
                (.txt, .vtt, .srt) — CaseCraft suggests value drivers, each with the line from
                the call that backs it.
              </li>
              <li>
                <strong>Pick the value drivers</strong> that apply, across Cost Savings,
                Productivity Gains, and Risk Reduction. Overlap flags are guidance, not
                blockers.
              </li>
              <li>
                <strong>Fill in the shared customer inputs</strong> the selected drivers ask
                for — every default is an editable illustrative assumption.
              </li>
              <li>
                <strong>Generate the case, then tune live.</strong> Every input recomputes
                ROI, payback, and the charts instantly with no AI call. Export a one-page PDF
                when it's ready.
              </li>
            </ol>
          </div>
        </section>
      </div>

      <div className="container">
        <div className="stack">
          <section className="card">
            <CardHead step={1} title="Deal basics" caption="The commercial shape of the deal." />
            <div className="card__body stack" style={{ gap: 16 }}>
              <div className="field-grid">
                <TextField id="company" label="Company name" value={deal.companyName}
                           onChange={(v) => set("companyName", v)} />
                <TextField id="domain" label="Domain" value={deal.domain ?? ""}
                           placeholder="acme.com" onChange={(v) => set("domain", v || null)} />
              </div>
              <div className="field-grid">
                <NumberField id="annual-cost" label="Platform annual cost" unit="USD/year"
                             value={deal.annualCost} onChange={(v) => set("annualCost", v)} />
                <NumberField id="one-time-cost" label="Implementation (one-time)" unit="USD"
                             value={deal.oneTimeCost} onChange={(v) => set("oneTimeCost", v)} />
                <NumberField id="term" label="Term" unit="count" value={deal.termYears}
                             suffix="years"
                             onChange={(v) => set("termYears", Math.max(1, Math.min(10, Math.round(v))))} />
              </div>
            </div>
          </section>

          <section className="card">
            <CardHead
              step={2}
              title="From the call"
              caption="Optional. Upload one or more calls (a follow-up can correct an earlier one) or paste notes, and get the drivers they support, each with the line that backs it up."
            />
            <TranscriptCard
              files={transcriptFiles}
              onAddFiles={onAddTranscriptFiles}
              onRemoveFile={onRemoveTranscriptFile}
              notes={transcriptNotes}
              onNotesChange={onTranscriptNotesChange}
              analysis={analysis}
              analyzing={analyzing}
              error={analysisError}
              driverCount={library.drivers.length}
              selected={selected}
              resolvedProposals={resolvedProposals}
              onAnalyze={onAnalyze}
              onAccept={onAcceptSuggestion}
              onAcceptAll={onAcceptAllSuggestions}
              onApplyProposal={onApplyProposal}
              onDismissProposal={onDismissProposal}
            />
          </section>

          <section className="card">
            <CardHead
              step={3}
              title="Value drivers"
              caption={
                outstanding > 0
                  ? `${outstanding} suggested from the call above, still to accept. Drivers start on their library defaults.`
                  : "Drivers start on their library defaults. Tune each one's inputs once the case is generated."
              }
            />
            <div className="card__body">
              <div className="tiles">
                {CATEGORIES.map((category) => {
                  const drivers = library.drivers.filter((d) => d.category === category);
                  const picked = drivers.filter((d) => selected.has(d.id)).length;
                  return (
                    <div key={category}>
                      <div className="tiles__group-head">
                        <span className="tiles__dot"
                              style={{ background: CATEGORY_HUE[category] }} />
                        <span className="tiles__group-name">{category}</span>
                        <span className="tiles__count">
                          {picked}/{drivers.length}
                        </span>
                      </div>
                      <div className="tiles__column">
                        {drivers.map((driver) => (
                          <DriverTile key={driver.id} driver={driver}
                                      selected={selected.has(driver.id)} onToggle={onToggle} />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              {conflicts.length > 0 && (
                <div style={{ marginTop: 20 }}>
                  <ConflictNotice conflicts={conflicts} />
                </div>
              )}
            </div>
          </section>

          <section className="card">
            <CardHead
              step={4}
              title="About the customer"
              caption={
                selected.size === 0
                  ? "Pick value drivers above — the shared inputs they need will appear here."
                  : needed.length === 0
                    ? "Nothing to collect: the selected drivers run entirely on their own inputs."
                    : `${needed.length} of ${library.globalInputs.length} shared inputs are used by this selection. Every default is an editable illustrative assumption.`
              }
            />
            {needed.length > 0 && (
              <div className="card__body">
                <div className="field-grid">
                  {needed.map((input) => (
                    <NumberField
                      key={input.key}
                      id={`global-${input.key}`}
                      label={input.label}
                      unit={input.unit}
                      value={globalValues[input.key] ?? input.defaultValue}
                      hint={input.notes}
                      onChange={(value) => onGlobalChange(input.key, value)}
                    />
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>

        <div className="submitbar">
          <div className="submitbar__inner">
            <div className="submitbar__summary">
              {!hasCompany ? (
                "Enter a company name in step 1 to generate a case."
              ) : selected.size === 0 ? (
                "Select at least one value driver to generate a case."
              ) : (
                <>
                  <span className="submitbar__count">{selected.size}</span>
                  {selected.size === 1 ? " driver" : " drivers"} selected
                  {conflicts.length > 0 && " · overlap flagged above, not a blocker"}
                </>
              )}
            </div>
            <button className="btn btn--primary btn--lg" onClick={onSubmit}
                    disabled={!canSubmit}>
              Generate business case
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
