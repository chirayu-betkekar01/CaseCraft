import { useId, useRef, useState } from "react";
import { GlobalProposalList } from "./GlobalProposalList";
import { SuggestionList } from "./SuggestionList";
import {
  MAX_TRANSCRIPT_CHARS,
  MIN_TRANSCRIPT_CHARS,
  TRANSCRIPT_EXTENSIONS,
  combineTranscriptSources,
  isSupportedTranscriptFile,
  pendingProposals,
  stripCueMarkup,
  unacceptedSuggestions,
  type AttachedFile,
} from "../lib/transcript";
import type { TranscriptAnalysis } from "../lib/types";

interface Props {
  files: AttachedFile[];
  notes: string;
  onNotesChange: (text: string) => void;
  onAddFiles: (files: AttachedFile[]) => void;
  onRemoveFile: (id: string) => void;
  analysis: TranscriptAnalysis | null;
  analyzing: boolean;
  error: string | null;
  driverCount: number;
  selected: Set<string>;
  resolvedProposals: Set<string>;
  onAnalyze: (text: string) => void;
  onAccept: (driverId: string) => void;
  onAcceptAll: (driverIds: string[]) => void;
  onApplyProposal: (key: string, value: number) => void;
  onDismissProposal: (key: string) => void;
}

export function TranscriptCard({
  files, notes, onNotesChange, onAddFiles, onRemoveFile,
  analysis, analyzing, error, driverCount,
  selected, resolvedProposals, onAnalyze, onAccept, onAcceptAll,
  onApplyProposal, onDismissProposal,
}: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const textareaId = useId();

  const combined = combineTranscriptSources(files, notes);
  const tooShort = combined.trim().length < MIN_TRANSCRIPT_CHARS;
  const tooLong = combined.length > MAX_TRANSCRIPT_CHARS;

  async function readFiles(fileList: FileList) {
    const picked = Array.from(fileList);
    const rejected = picked.filter((file) => !isSupportedTranscriptFile(file.name));
    const accepted = picked.filter((file) => isSupportedTranscriptFile(file.name));

    setFileError(
      rejected.length > 0
        ? `${rejected.map((file) => file.name).join(", ")} — not a plain-text transcript. Use ${TRANSCRIPT_EXTENSIONS.join(", ")}.`
        : null,
    );

    if (accepted.length === 0) return;

    // Cue markup comes off before the text is ever attached: the server
    // verifies quotes against exactly what it received, so stripping later
    // would break any quote that crossed a cue boundary.
    const stripped = await Promise.all(
      accepted.map(async (file) => ({
        id: crypto.randomUUID(),
        name: file.name,
        text: stripCueMarkup(await file.text()),
      })),
    );
    onAddFiles(stripped);
  }

  const suggestions = analysis ? unacceptedSuggestions(analysis.suggestions, selected) : [];
  const proposals = analysis
    ? pendingProposals(analysis.globalProposals, resolvedProposals)
    : [];
  const nothingLeft =
    analysis !== null && !analyzing && suggestions.length === 0 && proposals.length === 0;

  return (
    <div className="card__body">
      {files.length > 0 && (
        <div className="transcript-files">
          {files.map((file) => (
            <div className="transcript-file" key={file.id}>
              <span className="transcript-file__name">{file.name}</span>
              <button
                className="btn btn--icon"
                aria-label={`Remove ${file.name}`}
                onClick={() => onRemoveFile(file.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="field field--textarea">
        <label className="field__label" htmlFor={textareaId}>
          {files.length > 0 ? "Additional notes (optional)" : "Call transcript"}
        </label>
        <div className="field__input">
          <textarea
            id={textareaId}
            value={notes}
            placeholder={
              files.length > 0
                ? "Anything not captured in an uploaded call — optional."
                : "Paste the transcript of a discovery call, or upload one below."
            }
            onChange={(event) => onNotesChange(event.target.value)}
          />
        </div>
      </div>

      <div className="transcript__actions">
        <input
          ref={fileInput}
          type="file"
          multiple
          className="visually-hidden"
          accept={`${TRANSCRIPT_EXTENSIONS.join(",")},text/plain,text/markdown`}
          onChange={(event) => {
            if (event.target.files && event.target.files.length > 0) {
              void readFiles(event.target.files);
            }
            // Reset so picking the same file(s) again still fires onChange.
            event.target.value = "";
          }}
        />
        <button className="btn btn--ghost" onClick={() => fileInput.current?.click()}>
          Upload transcripts
        </button>

        <div className="transcript__spacer" />

        <button
          className="btn btn--primary"
          onClick={() => onAnalyze(combined)}
          disabled={analyzing || tooShort || tooLong}
          aria-busy={analyzing}
        >
          {analyzing ? "Analyzing…" : "Suggest value drivers"}
        </button>
      </div>

      {analyzing && (
        <>
          <div className="analysis-progress">
            <div className="analysis-progress__bar" />
          </div>
          <div className="analysis-progress__label" aria-live="polite">
            Reading the call{files.length > 1 ? "s" : ""} and matching against {driverCount} value
            drivers…
          </div>
        </>
      )}

      {fileError && (
        <div className="notice notice--warning" style={{ marginTop: 14 }}>
          <div className="notice__body">{fileError}</div>
        </div>
      )}

      {tooLong && (
        <div className="notice notice--warning" style={{ marginTop: 14 }}>
          <div className="notice__body">
            This would send {combined.length.toLocaleString("en-US")} characters, over the{" "}
            {MAX_TRANSCRIPT_CHARS.toLocaleString("en-US")} limit. Remove a file or shorten your
            notes.
          </div>
        </div>
      )}

      {error && (
        <div className="notice notice--danger" style={{ marginTop: 14 }}>
          <div className="notice__body">
            <div className="notice__title">Could not analyze the call</div>
            {error}
          </div>
        </div>
      )}

      <SuggestionList
        suggestions={suggestions}
        onAccept={onAccept}
        onAcceptAll={onAcceptAll}
      />
      <GlobalProposalList
        proposals={proposals}
        onApply={onApplyProposal}
        onDismiss={onDismissProposal}
      />

      {nothingLeft && (
        <div className="notice" style={{ marginTop: 14 }}>
          <div className="notice__body">
            {analysis.suggestions.length === 0
              ? "Nothing in this call clearly points to a driver in the library. Pick them by hand below."
              : "Every suggestion from this call has been dealt with."}
          </div>
        </div>
      )}

      {analysis && analysis.discarded.length > 0 && (
        // Showing what was thrown away keeps the filtering honest — silent
        // dropping would leave a rep wondering why a driver never appeared.
        <div className="transcript__dropped">
          {analysis.discarded.length} item
          {analysis.discarded.length === 1 ? "" : "s"} discarded: {analysis.discarded.join("; ")}.
        </div>
      )}
    </div>
  );
}
