import { describe, expect, it } from "vitest";
import {
  combineTranscriptSources,
  confidenceRank,
  isSupportedTranscriptFile,
  pendingProposals,
  stripCueMarkup,
  unacceptedSuggestions,
  type AttachedFile,
} from "./transcript";
import type { DriverSuggestion, GlobalProposal } from "./types";

const suggestion = (driverId: string): DriverSuggestion => ({
  driverId,
  name: driverId,
  category: "Cost Savings",
  confidence: "high",
  evidence: "",
  rationale: "",
  quoteVerified: true,
});

const proposal = (key: string): GlobalProposal => ({
  key,
  label: key,
  unit: "count",
  value: 1,
  currentDefault: 2,
  evidence: "",
  quoteVerified: true,
});

describe("stripCueMarkup", () => {
  it("removes the WEBVTT header and cue timing lines", () => {
    const vtt = [
      "WEBVTT",
      "",
      "00:00:03.000 --> 00:00:07.500",
      "We are paying for four agents on the same box.",
      "",
      "00:00:07.500 --> 00:00:11.000",
      "Finance has started asking questions.",
    ].join("\n");

    expect(stripCueMarkup(vtt)).toBe(
      "We are paying for four agents on the same box.\n\nFinance has started asking questions.",
    );
  });

  it("removes SRT index lines and timings", () => {
    const srt = [
      "1",
      "00:00:03,000 --> 00:00:07,500",
      "We run about 4000 endpoints.",
      "",
      "2",
      "00:00:07,500 --> 00:00:11,000",
      "Across two sites.",
    ].join("\n");

    expect(stripCueMarkup(srt)).toBe("We run about 4000 endpoints.\n\nAcross two sites.");
  });

  it("leaves plain prose untouched", () => {
    // The pasted path runs this too, so anything it damages here is damage
    // done to a transcript the rep typed in by hand.
    const prose =
      "Rep: Where does the pain sit?\n\nSecurity Lead: Most of a shift goes into triage.";

    expect(stripCueMarkup(prose)).toBe(prose);
  });

  it("keeps a line of digits that is part of the conversation", () => {
    // A bare number on its own line is an SRT index; one inside a sentence is
    // something the customer said, and losing it would lose a real figure.
    expect(stripCueMarkup("We run 4000 endpoints")).toBe("We run 4000 endpoints");
  });
});

describe("isSupportedTranscriptFile", () => {
  it("accepts the four plain-text transcript extensions", () => {
    for (const name of ["call.txt", "notes.md", "recording.vtt", "captions.srt"]) {
      expect(isSupportedTranscriptFile(name)).toBe(true);
    }
  });

  it("is not fooled by capitalization", () => {
    expect(isSupportedTranscriptFile("CALL.TXT")).toBe(true);
  });

  it("rejects formats that would need a parser", () => {
    for (const name of ["deck.pdf", "notes.docx", "sheet.xlsx"]) {
      expect(isSupportedTranscriptFile(name)).toBe(false);
    }
  });
});

describe("confidenceRank", () => {
  it("orders high above medium above low", () => {
    expect(confidenceRank("high")).toBeLessThan(confidenceRank("medium"));
    expect(confidenceRank("medium")).toBeLessThan(confidenceRank("low"));
  });
});

describe("unacceptedSuggestions", () => {
  it("hides drivers the rep has already selected", () => {
    const all = [suggestion("alpha"), suggestion("beta")];

    expect(unacceptedSuggestions(all, new Set(["alpha"]))).toEqual([suggestion("beta")]);
  });

  it("keeps everything when nothing has been accepted", () => {
    const all = [suggestion("alpha"), suggestion("beta")];

    expect(unacceptedSuggestions(all, new Set())).toHaveLength(2);
  });
});

describe("pendingProposals", () => {
  it("hides a proposal once it has been applied or dismissed", () => {
    const all = [proposal("endpointCount"), proposal("secOpsTeamSize")];

    expect(pendingProposals(all, new Set(["endpointCount"]))).toEqual([
      proposal("secOpsTeamSize"),
    ]);
  });
});

const file = (name: string, text: string): AttachedFile => ({ id: name, name, text });

describe("combineTranscriptSources", () => {
  it("returns an empty string when nothing is provided", () => {
    expect(combineTranscriptSources([], "")).toBe("");
  });

  it("returns pasted notes unlabeled when there are no files", () => {
    // This is the already-verified single-transcript path — it must behave
    // exactly as it did before multi-file upload existed.
    expect(combineTranscriptSources([], "  Rep: hello there  ")).toBe("Rep: hello there");
  });

  it("labels every attached file, in attachment order", () => {
    const combined = combineTranscriptSources(
      [file("discovery-call.txt", "First call text."), file("follow-up-call.txt", "Second call text.")],
      "",
    );

    expect(combined).toBe(
      "## discovery-call.txt\n\nFirst call text.\n\n## follow-up-call.txt\n\nSecond call text.",
    );
  });

  it("appends notes last, under their own label, when files are also present", () => {
    const combined = combineTranscriptSources(
      [file("discovery-call.txt", "Call text.")],
      "A rep's own reminder.",
    );

    expect(combined).toBe(
      "## discovery-call.txt\n\nCall text.\n\n## Additional notes\n\nA rep's own reminder.",
    );
  });

  it("drops empty notes rather than appending an empty label", () => {
    const combined = combineTranscriptSources([file("discovery-call.txt", "Call text.")], "   ");

    expect(combined).toBe("## discovery-call.txt\n\nCall text.");
  });
});
