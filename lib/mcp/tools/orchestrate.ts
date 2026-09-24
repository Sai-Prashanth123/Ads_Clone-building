import { z } from "zod";
import {
  inputRequired,
  inputResponse,
  type CreateMessageResult,
  type InputRequiredResult,
  type McpServer,
  type ServerContext,
} from "@modelcontextprotocol/server";
import { fetchPost } from "../../x/fetch-post";
import { engagementRate } from "../../x/types";
import { DECONSTRUCT_SYSTEM, VARIATIONS_SYSTEM } from "../../ai/prompts";
import { angles, DEFAULT_ANGLES } from "../../ai/schemas";
import {
  fieldsToText,
  generationMax,
  getFormat,
  PLATFORM_IDS,
} from "../../platforms";
import { validateAgainstSpec } from "../../platforms/validate";
import { checkConvergence, checkOriginality } from "../../originality";
import { checkFidelity, FIDELITY_THRESHOLD, fingerprint } from "../../fidelity";
import { isSwipeFileEnabled } from "../../db/client";
import { listSwipes } from "../../db/swipes";
import { autoCloneState, type AutoCloneState } from "../state";
import { fail, ok } from "../result";
import type { FieldSpec, FormatSpec } from "../../platforms/types";

/**
 * The server driving the work instead of hoping the host will.
 *
 * Every other tool here is a capability the host chooses to use. That is the
 * right default, and it has one hole: the guards only run if the model decides
 * to run them. A model that is confident about its own draft skips the loop, and
 * skipping the loop is the single failure this whole architecture exists to
 * prevent.
 *
 * `clone_ad_auto` closes it by inverting the direction. The server asks the
 * HOST'S model to write — sampling — then measures the answer itself and asks
 * again with the specific failure quoted. The loop is structural: it cannot be
 * skipped, because the caller never gets a result until the arithmetic passes or
 * the rounds run out.
 *
 * The 2026-07-28 protocol removed server→client push requests, so this is built
 * on multi-round-trip `inputRequired` rather than the deprecated
 * `server.createMessage`. Each round returns to the client and re-enters this
 * handler, with the loop's state signed and carried in `requestState`.
 */

const MAX_ROUNDS = 3;

/* ------------------------------------------------------------------ *
 * The brief
 * ------------------------------------------------------------------ */

function fieldLine(f: FieldSpec, bullet = "  • "): string {
  const limit = f.recommended
    ? `at most ${generationMax(f)} chars (truncates at ${f.recommended}, hard limit ${f.max})`
    : `hard limit ${f.max} chars`;
  const repeat = f.repeat ? `, supply ${f.repeat.min}–${f.repeat.max}` : "";
  return `${bullet}${f.key} — ${f.label}: ${limit}${repeat}. ${f.hint}`;
}

function shapeBrief(spec: FormatSpec): string[] {
  const lines = [
    `Fields for ${spec.label}:`,
    ...spec.fields.map((f) => fieldLine(f)),
  ];

  for (const group of spec.groups ?? []) {
    lines.push(
      `  • ${group.key} — an ARRAY of ${group.min}–${group.max} ${group.itemLabel.toLowerCase()} objects, in reading order. ${group.hint}`,
    );
    lines.push(...group.fields.map((f) => fieldLine(f, "    ◦ ")));
  }

  return lines;
}

/** The response contract, written as prose because sampling has no schema. */
function outputContract(spec: FormatSpec, chosen: string[]): string[] {
  return [
    "Reply with JSON ONLY — no prose, no markdown fence, no explanation.",
    "",
    "{",
    '  "dna": {',
    '    "hookType": "one of negative-framing, stat-callout, pain-point, contrarian, curiosity-gap, social-proof, before-after, listicle-promise, authority, question",',
    '    "beats": [{ "role": "hook|agitation|proof|mechanism|offer|cta|ps", "purpose": "one clause" }],',
    '    "whyItWorks": ["3-5 transferable lessons"]',
    "  },",
    '  "variations": [',
    "    {",
    `      "angle": "one of ${chosen.join(", ")}",`,
    '      "copy": { ...the fields below... },',
    '      "beatMapping": [{ "role": "hook", "line": "the line from YOUR copy serving that beat" }],',
    '      "imagePrompt": "a complete text-to-image prompt",',
    '      "visualMechanism": "one clause naming what the original visual did that yours reproduces",',
    '      "imageNegatives": "comma separated",',
    '      "altText": "...",',
    '      "rationale": "one sentence on what this angle changes"',
    "    }",
    "  ]",
    "}",
    "",
    `Exactly ${chosen.length} variations, one per angle, in that order.`,
    "",
    ...shapeBrief(spec),
    "",
    "beatMapping lines must be copied verbatim from your own copy — they are checked against it, not taken on trust.",
  ];
}

function referenceBrief(
  refs: { author: string | null; text: string; ratePct: number | null }[],
): string[] {
  if (refs.length === 0) return [];

  return [
    "",
    "Ads that measurably worked in this niche, ranked by engagement rate. Calibrate register, rhythm and specificity against them. Do NOT reuse their wording — it is checked.",
    "",
    ...refs.map(
      (r, i) =>
        `[reference ${i + 1}${r.ratePct != null ? `, ${r.ratePct}% engagement` : ""}]\n${r.text}`,
    ),
  ];
}

async function referenceAds(hookType?: string | null) {
  if (!isSwipeFileEnabled()) return [];

  try {
    const pool = await listSwipes({ hookType: hookType ?? undefined, limit: 50 });
    return pool
      .map((s) => ({
        author: s.author_handle,
        text: s.original_text,
        rate: engagementRate(
          (s.engagement ?? {}) as Parameters<typeof engagementRate>[0],
        ),
      }))
      .filter((r) => r.rate != null)
      .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0))
      .slice(0, 3)
      .map((r) => ({
        author: r.author,
        text: r.text,
        ratePct: r.rate != null ? Number((r.rate * 100).toFixed(2)) : null,
      }));
  } catch {
    // Grounding is a bonus. A swipe file that is down must not stop a clone.
    return [];
  }
}

function draftRequest(state: AutoCloneState, references: string[]): string {
  const spec = getFormat(state.platform, state.format);

  return [
    DECONSTRUCT_SYSTEM,
    "",
    "———",
    "",
    VARIATIONS_SYSTEM,
    "",
    "———",
    "",
    "THE AD TO CLONE:",
    "",
    state.source.text,
    "",
    ...references,
    "",
    "———",
    "",
    ...outputContract(spec, state.angles),
  ].join("\n");
}

/* ------------------------------------------------------------------ *
 * Reading the model back
 * ------------------------------------------------------------------ */

const draftSchema = z.object({
  dna: z
    .object({
      hookType: z.string().optional(),
      beats: z
        .array(z.object({ role: z.string(), purpose: z.string().optional() }))
        .optional(),
      whyItWorks: z.array(z.string()).optional(),
    })
    .optional(),
  variations: z
    .array(
      z.object({
        angle: z.string(),
        copy: z.record(z.string(), z.unknown()),
        beatMapping: z
          .array(z.object({ role: z.string(), line: z.string() }))
          .optional(),
        imagePrompt: z.string().optional(),
        visualMechanism: z.string().optional(),
        imageNegatives: z.string().optional(),
        altText: z.string().optional(),
        rationale: z.string().optional(),
      }),
    )
    .min(1),
});

type Draft = z.infer<typeof draftSchema>;

/** Pull the text out of a sampling result, whatever content shape it used. */
function samplingText(result: CreateMessageResult | unknown): string {
  const content = (result as { content?: unknown }).content;
  const blocks = Array.isArray(content) ? content : [content];

  return blocks
    .map((b) => {
      const block = b as { type?: string; text?: string } | null;
      return block?.type === "text" ? (block.text ?? "") : "";
    })
    .join("\n")
    .trim();
}

/**
 * Models wrap JSON in fences and preambles no matter how firmly told not to.
 * Recovering from that is cheaper than spending a round of the loop on it.
 */
export function parseDraft(text: string): Draft | null {
  const candidates: string[] = [];

  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  if (fenced) candidates.push(fenced[1]);

  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1));

  candidates.push(text);

  for (const candidate of candidates) {
    try {
      const parsed = draftSchema.safeParse(JSON.parse(candidate));
      if (parsed.success) return parsed.data;
    } catch {
      // Try the next shape.
    }
  }

  return null;
}

/* ------------------------------------------------------------------ *
 * Measuring
 * ------------------------------------------------------------------ */

type Verdict = {
  angle: string;
  text: string;
  copy: Record<string, unknown>;
  originality: ReturnType<typeof checkOriginality>;
  fidelity: ReturnType<typeof checkFidelity>;
  spec: ReturnType<typeof validateAgainstSpec>;
  beatMapping: { role: string; line: string }[];
  /** Beat lines the model claimed but did not actually write. */
  unquotedBeats: string[];
  failing: string[];
};

export function judge(draft: Draft, state: AutoCloneState): Verdict[] {
  const spec = getFormat(state.platform, state.format);

  return draft.variations.map((v) => {
    const text = fieldsToText(spec, v.copy);
    const originality = checkOriginality(text, state.source.text);
    const fidelity = checkFidelity(text, state.source.text);
    const specReport = validateAgainstSpec(spec, v.copy);

    const haystack = text.toLowerCase();
    const unquotedBeats = (v.beatMapping ?? [])
      .filter((b) => b.line.trim() && !haystack.includes(b.line.trim().toLowerCase()))
      .map((b) => `${b.role}: “${b.line}”`);

    const failing = [
      !originality.pass && "originality",
      !fidelity.pass && "fidelity",
      !specReport.pass && "platform spec",
      unquotedBeats.length > 0 && "beat mapping",
    ].filter((x): x is string => Boolean(x));

    return {
      angle: v.angle,
      text,
      copy: v.copy,
      originality,
      fidelity,
      spec: specReport,
      beatMapping: v.beatMapping ?? [],
      unquotedBeats,
      failing,
    };
  });
}

/** Exactly what to change, quoted — the difference between this and "try again". */
export function reviseInstructions(verdicts: Verdict[]): string[] {
  const lines: string[] = [];

  for (const v of verdicts.filter((x) => x.failing.length > 0)) {
    lines.push(`[${v.angle}] failing: ${v.failing.join(", ")}`);

    if (!v.originality.pass) {
      lines.push(
        `  Too close to the source (${v.originality.score}/100). Rewrite the lines containing: ${v.originality.sharedPhrases
          .slice(0, 5)
          .map((p) => `“${p}”`)
          .join(", ")}`,
      );
    }

    if (!v.fidelity.pass) {
      lines.push(
        `  Drifted from the source's shape (${v.fidelity.score}/100). Fix these, keeping your new wording:`,
      );
      lines.push(...v.fidelity.drifted.map((d) => `    − ${d}`));
    }

    if (!v.spec.pass) {
      lines.push(...v.spec.problems.map((p) => `  Off-spec: ${p}`));
    }

    if (v.unquotedBeats.length > 0) {
      lines.push(
        "  beatMapping claims lines that are not in your copy. Quote your copy verbatim or change the copy:",
      );
      lines.push(...v.unquotedBeats.map((b) => `    − ${b}`));
    }

    lines.push("");
  }

  return lines;
}

function reviseRequest(
  state: AutoCloneState,
  verdicts: Verdict[],
  previous: Draft,
): string {
  const spec = getFormat(state.platform, state.format);

  return [
    VARIATIONS_SYSTEM,
    "",
    "———",
    "",
    "Your previous draft was measured against the source. These are arithmetic results, not opinions:",
    "",
    ...reviseInstructions(verdicts),
    "———",
    "",
    "THE SOURCE AD (do not reuse its wording):",
    "",
    state.source.text,
    "",
    "———",
    "",
    "YOUR PREVIOUS DRAFT:",
    "",
    JSON.stringify({ variations: previous.variations }, null, 2),
    "",
    "———",
    "",
    "Fix only what is listed. Variations that are not named above already pass — return them unchanged, because a rewrite can break what was passing.",
    "",
    ...outputContract(spec, state.angles),
  ].join("\n");
}

function samplingLeg(prompt: string) {
  return inputRequired.createMessage({
    messages: [{ role: "user", content: { type: "text", text: prompt } }],
    // Enough for three full variations plus the framework. Too low here reads
    // as a malformed reply rather than as a truncation, which wastes a round.
    maxTokens: 8000,
    modelPreferences: { intelligencePriority: 0.9, speedPriority: 0.2 },
  });
}

/* ------------------------------------------------------------------ *
 * Reporting
 * ------------------------------------------------------------------ */

function report(verdicts: Verdict[], state: AutoCloneState, rounds: number) {
  const convergence = checkConvergence(
    verdicts.map((v) => ({ id: v.angle, text: v.text })),
  );

  return {
    platform: state.platform,
    format: getFormat(state.platform, state.format).id,
    rounds,
    source: {
      url: state.source.url,
      author: state.source.author,
      shape: fingerprint(state.source.text),
    },
    convergence: convergence.pass ? null : convergence,
    variations: verdicts.map((v) => ({
      angle: v.angle,
      verdict: v.failing.length === 0 ? "PASS" : "FAIL",
      failing: v.failing,
      summary: `originality ${v.originality.score}/100 · fidelity ${v.fidelity.score}/100 · spec ${v.spec.pass ? "ok" : "off-spec"}`,
      copy: v.copy,
      text: v.text,
      beatMapping: v.beatMapping,
      originality: v.originality,
      fidelity: v.fidelity,
      spec: v.spec,
    })),
  };
}

/* ------------------------------------------------------------------ *
 * The tool
 * ------------------------------------------------------------------ */

export function registerOrchestrationTools(server: McpServer): void {
  server.registerTool(
    "clone_ad_auto",
    {
      title: "Clone an ad end to end, with the revise loop enforced",
      description: [
        "One call: fetch the ad, deconstruct it, write the variations, measure them, and revise whatever failed — up to three rounds — before returning anything.",
        "",
        "The difference from doing this yourself with fetch_ad + the guards is that here the loop is STRUCTURAL. This tool measures every draft before you see it and will not return copy it has not checked. Use it when you want the verified result rather than the working session; use the individual tools when you want to make the judgement calls yourself.",
        "",
        `It generates by asking YOUR model to write (MCP sampling), so no external API key is involved and the writing is yours. Each round comes back to you for that generation${""}. If this client cannot answer sampling requests, the tool detects that and returns the complete brief instead — same instructions, same references, you drive the loop.`,
        "",
        `What it verifies, per variation: n-gram and rare-word overlap against the source, structural fidelity to the source's shape (must reach ${Math.round(FIDELITY_THRESHOLD * 100)}/100), every field against the platform's published limits, and that each beatMapping line actually appears in the copy.`,
        "",
        "It does NOT save or render images. Call generate_image and save_swipe once you are happy with what comes back.",
      ].join("\n"),
      inputSchema: {
        url: z.string().optional().describe("An x.com/twitter.com post URL."),
        text: z
          .string()
          .optional()
          .describe(
            "Pasted ad copy, for LinkedIn / Meta / Google ads whose libraries block automated reads.",
          ),
        author: z.string().optional(),
        platform: z
          .enum(PLATFORM_IDS as [string, ...string[]])
          .default("x")
          .describe("The platform to write FOR, which need not be the source's."),
        format: z
          .string()
          .optional()
          .describe(
            "Format id from get_platform_spec: thread, carousel, story, search. Defaults to the platform's single-image format.",
          ),
        angles: z
          .array(z.enum(angles))
          .min(1)
          .max(4)
          .optional()
          .describe(`Defaults to ${DEFAULT_ANGLES.join(", ")}.`),
        hookType: z
          .string()
          .optional()
          .describe(
            "The source's hook type, if you know it — used to pick grounding examples from the swipe file.",
          ),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args, ctx): Promise<ReturnType<typeof ok> | InputRequiredResult> => {
      const codec = autoCloneState();
      const carried = ctx.mcpReq.requestState<AutoCloneState>();

      /* ---- Re-entry: a sampling round came back ---- */
      if (carried && typeof carried === "object" && "round" in carried) {
        return resume(carried, ctx, codec);
      }

      /* ---- First entry ---- */
      const source = await resolveSource(args);
      if ("error" in source) return fail(source.error);

      const state: AutoCloneState = {
        round: 1,
        platform: args.platform,
        format: args.format,
        angles: args.angles ?? DEFAULT_ANGLES,
        source: source.source,
      };

      const references = referenceBrief(await referenceAds(args.hookType));
      const prompt = draftRequest(state, references);

      /* Can this connection carry a sampling round at all?
       *
       * Two different things have to be true, and one value answers both. On a
       * 2026-07-28 connection the per-request envelope carries the client's
       * capabilities and this accessor is backfilled from it, so an empty read
       * means the client genuinely cannot sample. On a 2025-era connection
       * served per-request — which is how this endpoint is deployed — nothing
       * is carried, and the SDK's own legacy shim refuses the round for that
       * reason: a stateless legacy request has no channel back to the client.
       *
       * Either way the loop cannot run, so degrade before issuing a request
       * that would be refused after the work of building it. */
      if (!server.server.getClientCapabilities()?.sampling) {
        return ok(guidedFallback(state, prompt));
      }

      return inputRequired({
        inputRequests: { draft: samplingLeg(prompt) },
        requestState: await codec.mint(state, ctx),
      });
    },
  );
}

/* ------------------------------------------------------------------ *
 * Pieces of the handler, kept out of it so the flow stays readable
 * ------------------------------------------------------------------ */

async function resolveSource(args: {
  url?: string;
  text?: string;
  author?: string;
}): Promise<{ source: AutoCloneState["source"] } | { error: string }> {
  if (args.text?.trim()) {
    return {
      source: {
        text: args.text.trim(),
        url: null,
        author: args.author ?? null,
      },
    };
  }

  if (!args.url?.trim()) {
    return {
      error:
        "Provide either `url` (an X post) or `text` (pasted copy for any platform).",
    };
  }

  const result = await fetchPost(args.url);
  if (!result.ok) {
    return {
      error: `${result.message}\n\nIf this is a LinkedIn, Meta or Google ad, those libraries block automated reads — paste the copy as \`text\` instead.`,
    };
  }

  return {
    source: {
      text: result.post.text,
      url: result.post.url || null,
      author: result.post.author.handle || null,
    },
  };
}

/** Everything the loop would have done, handed over for the host to do. */
function guidedFallback(state: AutoCloneState, prompt: string) {
  return {
    mode: "guided",
    why: "This connection cannot carry a sampling round — either the client does not support it, or it negotiated a protocol revision whose per-request serving has no channel back to the client. Nothing is lost: the brief below is byte-for-byte the one the loop would have sent, including the reference ads.",
    nextSteps: [
      "Write the variations against the brief.",
      "Call check_clone on each one, with the source text and the platform and format below.",
      "Revise whatever it names and check again. Do not present unchecked copy.",
      "Then generate_image and save_swipe.",
    ],
    platform: state.platform,
    format: getFormat(state.platform, state.format).id,
    angles: state.angles,
    sourceText: state.source.text,
    brief: prompt,
  };
}

async function resume(
  state: AutoCloneState,
  ctx: ServerContext,
  codec: ReturnType<typeof autoCloneState>,
): Promise<ReturnType<typeof ok> | InputRequiredResult> {
  const response = inputResponse(ctx.mcpReq.inputResponses, "draft");

  if (response.kind !== "sampling") {
    // A declined or dropped round is the end of the loop, not a reason to
    // silently start over — starting over would re-spend the whole budget.
    return fail(
      [
        "The sampling round did not come back, so nothing has been measured.",
        "",
        state.best
          ? `The best draft so far scored originality ${state.best.originality}/100 and fidelity ${state.best.fidelity}/100, failing: ${state.best.failing.join(", ") || "nothing"}.`
          : "No draft was produced.",
        "",
        "Call clone_ad_auto again, or work with fetch_ad and check_clone directly.",
      ].join("\n"),
    );
  }

  const text = samplingText(response.result);
  const draft = parseDraft(text);

  if (!draft) {
    if (state.round >= MAX_ROUNDS) {
      return fail(
        `The model's reply could not be read as the required JSON after ${MAX_ROUNDS} attempts. Last reply began: ${text.slice(0, 300)}`,
      );
    }

    const next: AutoCloneState = { ...state, round: state.round + 1 };
    return inputRequired({
      inputRequests: {
        draft: samplingLeg(
          [
            "Your previous reply was not valid JSON, so nothing could be measured.",
            "",
            "Reply with the JSON object only — no prose before it, no markdown fence around it.",
            "",
            "Your previous reply began:",
            text.slice(0, 500),
          ].join("\n"),
        ),
      },
      requestState: await codec.mint(next, ctx),
    });
  }

  const verdicts = judge(draft, state);
  const failing = verdicts.filter((v) => v.failing.length > 0);

  /* ---- Everything passes ---- */
  if (failing.length === 0) {
    return ok({
      verdict: "PASS",
      summary: `${verdicts.length} variations passed every guard in ${state.round} round${state.round === 1 ? "" : "s"}.`,
      nextStep: "Safe to present. Then generate_image and save_swipe.",
      ...report(verdicts, state, state.round),
    });
  }

  /* ---- Out of rounds: return what there is, and say what is wrong ---- */
  if (state.round >= MAX_ROUNDS) {
    return ok({
      verdict: "PARTIAL",
      summary: `${verdicts.length - failing.length} of ${verdicts.length} variations passed after ${MAX_ROUNDS} rounds. The rest are returned unverified.`,
      nextStep:
        "The failing variations are below with exactly what is wrong. Fix them yourself and re-check with check_clone, or drop them — do not present them as verified.",
      ...report(verdicts, state, state.round),
    });
  }

  /* ---- Revise ---- */
  const best = verdicts.reduce((a, b) =>
    a.originality.score + a.fidelity.score >= b.originality.score + b.fidelity.score
      ? a
      : b,
  );

  const next: AutoCloneState = {
    ...state,
    round: state.round + 1,
    best: {
      round: state.round,
      originality: best.originality.score,
      fidelity: best.fidelity.score,
      draft: draft.variations,
      failing: best.failing,
    },
  };

  return inputRequired({
    inputRequests: { draft: samplingLeg(reviseRequest(state, verdicts, draft)) },
    requestState: await codec.mint(next, ctx),
  });
}
