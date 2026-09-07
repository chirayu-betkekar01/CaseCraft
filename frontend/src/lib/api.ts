import type {
  CaseResponse,
  Deal,
  Library,
  Selections,
  TranscriptAnalysis,
} from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });

  if (!response.ok) {
    const detail = await response
      .json()
      .then((body: { detail?: unknown }) => body.detail)
      .catch(() => null);
    throw new Error(
      typeof detail === "string" ? detail : `${response.status} ${response.statusText}`,
    );
  }
  return response.json() as Promise<T>;
}

export const fetchLibrary = (): Promise<Library> => request<Library>("/api/library");

export function computeCase(
  deal: Deal,
  selections: Selections,
  globalValues: Record<string, number>,
  signal?: AbortSignal,
): Promise<CaseResponse> {
  return request<CaseResponse>("/api/case", {
    method: "POST",
    body: JSON.stringify({ deal, selections, globalValues }),
    signal,
  });
}

/**
 * The expensive path: one model call, run on an explicit click.
 *
 * Text in JSON rather than a multipart upload, which is why this reuses
 * `request` untouched — a file part would have needed its own helper, since
 * `request` always sets a JSON content type.
 */
export function analyzeTranscript(
  transcript: string,
  signal?: AbortSignal,
): Promise<TranscriptAnalysis> {
  return request<TranscriptAnalysis>("/api/transcript", {
    method: "POST",
    body: JSON.stringify({ transcript }),
    signal,
  });
}
