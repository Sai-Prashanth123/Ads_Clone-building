import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import {
  checkConvergence,
  checkOriginality,
  CONVERGENCE_THRESHOLDS,
  THRESHOLDS,
} from "../../originality";
import type { FormatSpec, PlatformId } from "../../platforms/types";
import {
  generationMax,
  getFormat,
  PLATFORM_IDS,
  PLATFORMS,
} from "../../platforms";
import { validateAgainstSpec } from "../../platforms/validate";
import {
  checkFidelity,
  FIDELITY_THRESHOLD,
  verifyBeatMapping,
} from "../../fidelity";
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
    "check_fidelity",
    {
      title: "Check the clone kept the original's shape",
      description: [
        "Measure how FAITHFUL a draft is to its source — the opposite axis from check_originality.",
        "",
        "The two pull against each other. Unrelated text scores 100% original and 0% faithful; a verbatim copy is the reverse. A good clone is high on BOTH, and nothing else can tell a faithful rewrite from a draft that drifted into a different ad.",
        "",
        "Compares opening move, list shape, sentence rhythm, block structure, emphasis and stat density — computed from the text, not judged. `drifted` names exactly what changed, e.g. 'the original opens with a number; yours opens with a question'.",
        "",
        `Fails below ${Math.round(FIDELITY_THRESHOLD * 100)}. If it fails, you have written a good ad that is not a clone of this one.`,
      ].join("\n"),
      inputSchema: {
        candidate: z.string().min(1).describe("Your draft."),
        original: z.string().min(1).describe("The source ad's text."),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ candidate, original }) => ok(checkFidelity(candidate, original)),
  );

  server.registerTool(
    "check_clone",
    {
      title: "All three verdicts at once",
      description: [
        "Run every guard on one draft and return a combined verdict: originality, fidelity, and platform spec.",
        "",
        "Use this rather than the individual tools. The three have to be read together — passing one while failing another is the interesting case, and checking them separately invites fixing one and breaking the next.",
        "",
        "Optionally verifies beatMapping: every claimed line must actually appear in your copy, and the roles must follow the source's beat order. Without this the mapping is just an assertion.",
      ].join("\n"),
      inputSchema: {
        candidate: z
          .string()
          .min(1)
          .describe("The draft's full text, all fields joined."),
        original: z.string().min(1),
        platform: z.enum(PLATFORM_IDS as [string, ...string[]]).optional(),
        format: z.string().optional().describe("Format id, e.g. 'carousel'."),
        fields: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Field key -> copy, for the spec check."),
        beatMapping: z
          .array(z.object({ role: z.string(), line: z.string() }))
          .optional(),
        sourceBeatRoles: z
          .array(z.string())
          .optional()
          .describe("Beat roles from the source DNA, in order."),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({
      candidate,
      original,
      platform,
      format,
      fields,
      beatMapping,
      sourceBeatRoles,
    }) => {
      const originality = checkOriginality(candidate, original);
      const fidelity = checkFidelity(candidate, original);

      const spec =
        platform && fields
          ? validateAgainstSpec(getFormat(platform, format), fields)
          : null;

      const beats =
        beatMapping && sourceBeatRoles
          ? verifyBeatMapping(candidate, beatMapping, sourceBeatRoles)
          : null;

      const failures = [
        !originality.pass && "originality",
        !fidelity.pass && "fidelity",
        spec && !spec.pass && "platform spec",
        beats && !beats.pass && "beat mapping",
      ].filter(Boolean);

      return ok({
        verdict: failures.length === 0 ? "PASS" : "FAIL",
        failing: failures,
        // Both axes in one line, because the shape of the pair is the signal.
        summary: `originality ${originality.score}/100 · fidelity ${fidelity.score}/100${
          spec ? ` · spec ${spec.pass ? "ok" : "off-spec"}` : ""
        }`,
        nextStep:
          failures.length === 0
            ? "All guards pass. Safe to present and save."
            : "Revise and check again. Details below name exactly what to change.",
        originality,
        fidelity,
        spec,
        beatMapping: beats,
      });
    },
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
        format: z
          .string()
          .optional()
          .describe("Format id from get_platform_spec, e.g. carousel, thread, search, story."),
        fields: z
          .record(z.string(), z.unknown())
          .describe("Field key -> copy. Arrays for repeated fields; arrays of objects for card groups."),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ platform, format, fields }) =>
      ok(validateAgainstSpec(getFormat(platform, format), fields)),
  );

  server.registerTool(
    "get_platform_spec",
    {
      title: "Get a platform's ad formats",
      description: [
        "Field structure, character limits and aspect ratios for every format a platform offers. Call this BEFORE writing copy — the field names here are what validate_ad, check_clone and save_swipe expect.",
        "",
        "Each platform has SEVERAL formats, and the choice matters more than the wording. A long-form listicle cloned into a single X post loses the list; cloned into a thread it keeps it. Read each format's `note` and pick the one whose shape matches the source ad, then pass its `id` as `format` everywhere after.",
        "",
        "`writeAtMost` is the length to aim for. It sits slightly above `truncatesAt` (where the feed cuts the copy) and well below `hardLimit` (where the platform rejects the ad), because a field given 3,000 characters of room gets filled regardless of what the guidance says.",
        "",
        "`groups` are repeating records — carousel cards, thread posts. Supply them as an array of objects keyed by the group's `key`, each object carrying that group's fields. `fields` with a `repeat` are a plain array of strings instead.",
        "",
        "Omit `platform` for every platform, or pass `format` to get one format alone.",
      ].join("\n"),
      inputSchema: {
        platform: z.enum(PLATFORM_IDS as [string, ...string[]]).optional(),
        format: z
          .string()
          .optional()
          .describe("Narrow to one format id. Requires platform."),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ platform, format }) => {
      const describeField = (f: (typeof PLATFORMS)["x"]["fields"][number]) => ({
        key: f.key,
        label: f.label,
        hardLimit: f.max,
        truncatesAt: f.recommended,
        writeAtMost: generationMax(f),
        repeat: f.repeat,
        multiline: f.multiline,
        hint: f.hint,
      });

      const describeFormat = (spec: FormatSpec) => ({
        id: spec.id,
        label: spec.label,
        note: spec.note,
        aspectRatios: spec.aspectRatios,
        defaultAspect: spec.defaultAspect,
        ctaOptions: spec.ctaOptions,
        fields: spec.fields.map(describeField),
        groups: spec.groups?.map((g) => ({
          key: g.key,
          label: g.label,
          itemLabel: g.itemLabel,
          count: { min: g.min, max: g.max },
          hint: g.hint,
          fields: g.fields.map(describeField),
        })),
      });

      // One format asked for by name.
      if (platform && format) {
        const spec = getFormat(platform, format);
        return ok({ platform, ...describeFormat(spec) });
      }

      const ids = platform ? [platform as PlatformId] : PLATFORM_IDS;

      return ok(
        ids.map((id) => {
          const spec = PLATFORMS[id];
          return {
            id: spec.id,
            label: spec.label,
            note: spec.note,
            defaultFormat: spec.formats[0].id,
            formats: spec.formats.map(describeFormat),
          };
        }),
      );
    },
  );
}
