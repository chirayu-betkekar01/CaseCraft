import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ThemeToggle } from "./components/ThemeToggle";
import { analyzeTranscript, computeCase, fetchLibrary } from "./lib/api";
import type { AttachedFile } from "./lib/transcript";
import { CaseView } from "./views/CaseView";
import { FormView } from "./views/FormView";
import type {
  CaseResponse,
  Deal,
  Library,
  Selections,
  TranscriptAnalysis,
} from "./lib/types";

const INITIAL_DEAL: Deal = {
  companyName: "",
  domain: "",
  annualCost: 280_000,
  oneTimeCost: 60_000,
  termYears: 3,
};

/** Debounce for the recompute request. Long enough that dragging a slider does
 * not fire a request per pixel, short enough to still feel immediate. */
const RECOMPUTE_DELAY_MS = 90;

export default function App() {
  const [library, setLibrary] = useState<Library | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [deal, setDeal] = useState<Deal>(INITIAL_DEAL);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Selections>({});
  const [globalValues, setGlobalValues] = useState<Record<string, number>>({});

  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState<CaseResponse | null>(null);
  const [stale, setStale] = useState(false);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);

  const [transcriptNotes, setTranscriptNotes] = useState("");
  const [transcriptFiles, setTranscriptFiles] = useState<AttachedFile[]>([]);
  const [analysis, setAnalysis] = useState<TranscriptAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [resolvedProposals, setResolvedProposals] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchLibrary().then(setLibrary).catch((error: Error) => setLoadError(error.message));
  }, []);

  // Only the selected drivers are sent, so deselecting a driver drops its
  // overrides from the request while keeping them for if it comes back.
  const selections: Selections = useMemo(() => {
    const active: Selections = {};
    for (const id of selected) active[id] = overrides[id] ?? {};
    return active;
  }, [selected, overrides]);

  const inflight = useRef<AbortController | null>(null);
  // Deliberately a second controller. Sharing one would let a recompute abort
  // an analysis mid-flight the moment the rep nudged a number while waiting.
  const analysisInflight = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!submitted) return;
    setStale(true);

    const timer = setTimeout(() => {
      inflight.current?.abort();
      const controller = new AbortController();
      inflight.current = controller;

      const started = performance.now();
      computeCase(deal, selections, globalValues, controller.signal)
        .then((response) => {
          setResult(response);
          setElapsedMs(performance.now() - started);
          setStale(false);
        })
        .catch((error: Error) => {
          if (error.name !== "AbortError") {
            setLoadError(error.message);
            setStale(false);
          }
        });
    }, RECOMPUTE_DELAY_MS);

    return () => clearTimeout(timer);
  }, [submitted, deal, selections, globalValues]);

  const toggle = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const setGlobal = useCallback((key: string, value: number) => {
    setGlobalValues((current) => ({ ...current, [key]: value }));
  }, []);

  const setOverride = useCallback((driverId: string, key: string, value: number) => {
    setOverrides((current) => ({
      ...current,
      [driverId]: { ...current[driverId], [key]: value },
    }));
  }, []);

  /**
   * The expensive path, and the only thing that writes `analysis`.
   *
   * `analysis` appears in no effect's dependency array, so typing in the
   * transcript box fetches nothing and neither does changing an input.
   * Accepting a suggestion changes `selected`, which flows into `selections`
   * and recomputes through the debounced /api/case call above — the cheap
   * path. One model call per button press, cached here until the next one.
   */
  const runAnalysis = useCallback((text: string) => {
    analysisInflight.current?.abort();
    const controller = new AbortController();
    analysisInflight.current = controller;

    setAnalyzing(true);
    setAnalysisError(null);

    analyzeTranscript(text, controller.signal)
      .then((response) => {
        setAnalysis(response);
        setResolvedProposals(new Set());
      })
      .catch((error: Error) => {
        // A failed analysis must not blank the app the way a failed library
        // fetch does — the rep's transcript is still in the box.
        if (error.name !== "AbortError") setAnalysisError(error.message);
      })
      .finally(() => setAnalyzing(false));
  }, []);

  // Accepting adds; it never toggles. Clicking Accept twice must not undo it —
  // deselecting stays on the driver tile, where it reads as deselecting.
  const acceptSuggestion = useCallback((id: string) => {
    setSelected((current) => new Set(current).add(id));
  }, []);

  const acceptAllSuggestions = useCallback((ids: string[]) => {
    setSelected((current) => {
      const next = new Set(current);
      for (const id of ids) next.add(id);
      return next;
    });
  }, []);

  const applyProposal = useCallback((key: string, value: number) => {
    setGlobalValues((current) => ({ ...current, [key]: value }));
    setResolvedProposals((current) => new Set(current).add(key));
  }, []);

  const dismissProposal = useCallback((key: string) => {
    setResolvedProposals((current) => new Set(current).add(key));
  }, []);

  const addTranscriptFiles = useCallback((added: AttachedFile[]) => {
    setTranscriptFiles((current) => [...current, ...added]);
  }, []);

  const removeTranscriptFile = useCallback((id: string) => {
    setTranscriptFiles((current) => current.filter((file) => file.id !== id));
  }, []);

  if (loadError) {
    return (
      <div className="error-box">
        <h2>Could not reach the modeling API</h2>
        <p>
          The frontend is running, but <code>/api</code> did not respond. Start the backend
          and reload.
        </p>
        <code>uvicorn api:app --reload --app-dir backend</code>
        <p style={{ marginTop: 12 }}>{loadError}</p>
      </div>
    );
  }

  if (!library) return <div className="loading">Loading value driver library…</div>;

  return (
    <div className="shell">
      <div className="topbar">
        <div className="container container--wide topbar__inner">
          <div className="wordmark">
            <span className="wordmark__mark">C</span>
            CaseCraft
          </div>
          <div className="topbar__spacer" />
          <ThemeToggle />
        </div>
      </div>

      {submitted ? (
        <CaseView
          library={library}
          deal={deal}
          selected={selected}
          selections={selections}
          globalValues={globalValues}
          result={result}
          stale={stale}
          elapsedMs={elapsedMs}
          onGlobalChange={setGlobal}
          onOverrideChange={setOverride}
          onBack={() => setSubmitted(false)}
        />
      ) : (
        <FormView
          library={library}
          deal={deal}
          onDealChange={setDeal}
          selected={selected}
          onToggle={toggle}
          globalValues={globalValues}
          onGlobalChange={setGlobal}
          transcriptNotes={transcriptNotes}
          onTranscriptNotesChange={setTranscriptNotes}
          transcriptFiles={transcriptFiles}
          onAddTranscriptFiles={addTranscriptFiles}
          onRemoveTranscriptFile={removeTranscriptFile}
          analysis={analysis}
          analyzing={analyzing}
          analysisError={analysisError}
          resolvedProposals={resolvedProposals}
          onAnalyze={runAnalysis}
          onAcceptSuggestion={acceptSuggestion}
          onAcceptAllSuggestions={acceptAllSuggestions}
          onApplyProposal={applyProposal}
          onDismissProposal={dismissProposal}
          onSubmit={() => {
            setSubmitted(true);
            window.scrollTo({ top: 0 });
          }}
        />
      )}
    </div>
  );
}
