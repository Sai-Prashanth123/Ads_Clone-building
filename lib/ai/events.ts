import type { AdDna } from "./schemas";
import type { ScoredVariation } from "./variations";
import type { SourcePost } from "../x/types";

/**
 * The pipeline has distinct stages with non-AI work between them, so it
 * streams discrete events rather than one partial object. Each line of the
 * response body is one of these, JSON-encoded.
 */
export type CloneEvent =
  | { type: "status"; stage: Stage; message: string }
  | { type: "post"; post: SourcePost; imageAnalysed?: boolean }
  | { type: "dna"; dna: AdDna }
  | { type: "variations"; variations: ScoredVariation[] }
  | { type: "error"; message: string; recoverable: boolean }
  | { type: "done" };

export type Stage =
  | "fetching"
  | "reading"
  | "writing"
  | "checking"
  | "rewriting"
  | "done";

export const STAGE_LABELS: Record<Stage, string> = {
  fetching: "Reading the post",
  reading: "Deconstructing the framework",
  writing: "Writing the variations",
  checking: "Checking originality",
  rewriting: "Rewriting to clear the guard",
  done: "Done",
};

/**
 * The rail only shows the stages that always happen. `rewriting` is
 * conditional — it appears in place of `checking` when the guard rejects a
 * draft, which is exactly when the user most needs to know why the wait grew.
 */
export const RAIL_STAGES: Stage[] = [
  "fetching",
  "reading",
  "writing",
  "checking",
];

export function encodeEvent(event: CloneEvent): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(event)}\n`);
}

/** Parse a stream of newline-delimited events, tolerating split chunks. */
export function createEventParser() {
  let buffer = "";
  return function push(chunk: string): CloneEvent[] {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    const events: CloneEvent[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        events.push(JSON.parse(trimmed) as CloneEvent);
      } catch {
        // A malformed line is not worth killing the run over.
      }
    }
    return events;
  };
}
