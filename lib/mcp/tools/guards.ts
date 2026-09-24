import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import {
  checkConvergence,
  checkOriginality,
  CONVERGENCE_THRESHOLDS,
  THRESHOLDS,
} from "../../originality";
import {
  generationMax,
  getPlatform,
  PLATFORM_IDS,
  PLATFORMS,
} from "../../platforms";
import { validateAgainstSpec } from "../../platforms/validate";
import { ok } from "../result";

/**
 * The guards.
 *
 * These are the point of this server. A language model cannot reliably count
 * characters or measure n-gram overlap against a 2,000-word source — it will
 * produce a confident number that is wrong. These tools return arithmetic.
 *
 * And because the host can call them repeatedly, it gets something the old
 * server-side pipeline never had: a loop. The previous design ran one scripted
 * retry and shipped whatever came back. A host with these tools can revise and
 * re-check until the copy actually passes, then say what it changed.
 */
export function registerGuardTools(server: McpServer): void {
  server.registerTool(
    "check_originality",
    {
      title: "Check originality against the source ad",
      description: [
        "Score a draft against the ORIGINAL ad it was derived from. Returns arithmetic, not an opinion.",
        "",
        "Three independent signals, because each alone is easy to game:",
        `• n-gram overlap — wholesale paraphrase. Fails above ${THRESHOLDS.ngramOverlap}.`,
        `• longest shared run — one lifted sentence inside otherwise fresh copy, which n-gram overlap dilutes to nothing. Fails at ${THRESHOLDS.longestSharedRun}+ words.`,
        `• rare-word overlap — lifted distinctive vocabulary. Fails above ${THRESHOLDS.rareWordOverlap}.`,
        "",
        "If `pass` is false, rewrite the lines containing `sharedPhrases` and call this again. Do not ship a flagged draft.",
      ].join("\n"),
      inputSchema: {
        candidate: z.string().min(1).describe("The draft you wrote."),
        original: z.string().min(1).describe("The source ad's text."),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ candidate, original }) => ok(checkOriginality(candidate, original)),
  );

  server.registerTool(
    "check_convergence",
    {
      title: "Check variations against each other",
      description: [
        "Compare drafts against ONE ANOTHER, not against the source.",
        "",
        "A set can pass check_originality unanimously and still be three paraphrases of one idea. That is the failure that wastes a batch, and it is the one you cannot self-assess — your own variations always feel distinct while you are writing them.",
        "",
        `Thresholds are looser than the source check (${CONVERGENCE_THRESHOLDS.ngramOverlap} overlap, ${CONVERGENCE_THRESHOLDS.longestSharedRun}-word runs): variations of one ad SHOULD share a subject and a structure. What they must not share is wording.`,
        "",
        "Run this once you have all variations, before saving.",
      ].join("\n"),
      inputSchema: {
        items: z
          .array(
            z.object({
              id: z.string().describe("Angle name or any stable label."),
              text: z.string().min(1),
            }),
          )
          .min(2)
          .describe("Every variation in the set."),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ items }) => ok(checkConvergence(items)),
  );

  server.registerTool(
    "validate_ad",
    {
      title: "Validate copy against a platform's published spec",
      description: [
        "Check each field against the platform's real character limits.",
        "",
        "`over` is a hard failure — the platform rejects the ad.",
        "`warn` means the field passes its truncation point: it still runs, it just stops being read. Front-load the decisive words rather than cutting to fit.",
        "`count` means a repeated field has the wrong number of entries (Google wants 3–5 short headlines).",
        "",
        "Call get_platform_spec first for the field names this expects.",
      ].join("\n"),
      inputSchema: {
        platform: z.enum(PLATFORM_IDS as [string, ...string[]]),
        fields: z
          .record(z.string(), z.union([z.string(), z.array(z.string())]))
          .describe("Field key -> copy. Arrays for repeated fields."),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ platform, fields }) =>
      ok(validateAgainstSpec(getPlatform(platform), fields)),
  );

  server.registerTool(
    "get_platform_spec",
    {
      title: "Get a platform's ad format",
      description: [
        "The field structure, character limits and aspect ratios for an ad platform. Call this BEFORE writing copy — the field names here are what validate_ad and save_swipe expect.",
        "",
        "`writeAtMost` is the length to aim for. It sits slightly above `recommended` (the truncation point) and well below `max` (the hard limit), because a field given 3,000 characters of room gets filled regardless of what the guidance says.",
        "",
        "Omit `platform` to get every platform.",
      ].join("\n"),
      inputSchema: {
        platform: z.enum(PLATFORM_IDS as [string, ...string[]]).optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ platform }) => {
      const specs = platform
        ? [getPlatform(platform)]
        : PLATFORM_IDS.map((id) => PLATFORMS[id]);

      return ok(
        specs.map((spec) => ({
          id: spec.id,
          label: spec.label,
          formatName: spec.formatName,
          note: spec.note,
          aspectRatios: spec.aspectRatios,
          defaultAspect: spec.defaultAspect,
          ctaOptions: spec.ctaOptions,
          fields: spec.fields.map((f) => ({
            key: f.key,
            label: f.label,
            hardLimit: f.max,
            truncatesAt: f.recommended,
            writeAtMost: generationMax(f),
            repeat: f.repeat,
            hint: f.hint,
          })),
        })),
      );
    },
  );
}
