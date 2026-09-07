import type { Confidence, DriverSuggestion, GlobalProposal } from "./types";

/** Call-recording exports that are already plain text. Anything needing a
 *  parser would mean a backend dependency, which this feature does without. */
export const TRANSCRIPT_EXTENSIONS = [".txt", ".md", ".vtt", ".srt"];

/** Matches the server's own floor, so a doomed request is never sent. */
export const MIN_TRANSCRIPT_CHARS = 40;

/** Matches the server's own ceiling (api.py's TranscriptRequest), so an
 *  oversized combination is caught before the request rather than after. */
export const MAX_TRANSCRIPT_CHARS = 200_000;

/** One uploaded file, already stripped of cue markup and ready to combine. */
export interface AttachedFile {
  id: string;
  name: string;
  text: string;
}

export function isSupportedTranscriptFile(name: string): boolean {
  const lower = name.toLowerCase();
  return TRANSCRIPT_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

const WEBVTT_HEADER = /^WEBVTT.*$/i;
const CUE_TIMING = /^(\d{2}:)?\d{2}:\d{2}[.,]\d{3}\s+-->\s+(\d{2}:)?\d{2}:\d{2}[.,]\d{3}/;
const SRT_INDEX = /^\d+$/;

/**
 * Strip subtitle scaffolding, leaving the spoken lines.
 *
 * This runs before the request on both paths — uploaded and pasted — and that
 * ordering is load-bearing. The server verifies every quote against the exact
 * text it was given, so if cue timings were removed after the call instead of
 * before it, a quote spanning a cue boundary could never verify.
 *
 * A no-op on plain prose, which is why the pasted path can run it safely.
 */
export function stripCueMarkup(text: string): string {
  const kept = text
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      if (WEBVTT_HEADER.test(trimmed)) return false;
      if (CUE_TIMING.test(trimmed)) return false;
      if (SRT_INDEX.test(trimmed)) return false;
      return true;
    })
    .join("\n");

  // Cue removal leaves runs of blank lines behind; collapse them so the model
  // sees a conversation rather than a column of gaps.
  return kept.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Combine attached files and typed notes into the one string /api/transcript
 * takes. Called once, at the moment Analyze is clicked — nothing upstream of
 * this holds a "combined" copy.
 *
 * No files, just notes: returned exactly as typed, unlabeled. This is the
 * already-verified single-transcript path, preserved byte for byte, so
 * pasting one call with zero files attached behaves exactly as it always has.
 *
 * One or more files: each is labeled "## <filename>" in attachment order, so
 * the server sees explicit call boundaries — the backend's prompt tells the
 * model these mark chronological calls and that a later one corrects an
 * earlier one on a disagreement, which only works if the order here matches
 * the order the rep actually attached them. Typed notes, if present, are
 * appended last under their own label so the model doesn't mistake a rep's
 * own commentary for something the customer said.
 */
export function combineTranscriptSources(files: AttachedFile[], notes: string): string {
  const trimmedNotes = notes.trim();

  if (files.length === 0) return trimmedNotes;

  const parts = files.map((file) => `## ${file.name}\n\n${file.text.trim()}`);
  if (trimmedNotes) parts.push(`## Additional notes\n\n${trimmedNotes}`);

  return parts.join("\n\n");
}

const RANK: Record<Confidence, number> = { high: 0, medium: 1, low: 2 };

export const confidenceRank = (confidence: Confidence): number => RANK[confidence];

/** Suggestions the rep has not acted on yet — accepting one removes it. */
export const unacceptedSuggestions = (
  suggestions: DriverSuggestion[],
  selected: Set<string>,
): DriverSuggestion[] => suggestions.filter((s) => !selected.has(s.driverId));

/** Proposals still awaiting a decision. Applying or dismissing resolves one. */
export const pendingProposals = (
  proposals: GlobalProposal[],
  resolved: Set<string>,
): GlobalProposal[] => proposals.filter((p) => !resolved.has(p.key));
