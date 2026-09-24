import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { isSwipeFileEnabled, SWIPE_FILE_SETUP_HINT } from "../../db/client";
import { deleteSwipe, getSwipe, listSwipes, saveSwipe } from "../../db/swipes";
import { buildPlaybook } from "../../analysis/playbook";
import { describeError } from "../../ai/errors";
import { adDnaSchema } from "../../ai/schemas";
import { PLATFORM_IDS } from "../../platforms";
import { fingerprint } from "../../fidelity";
import { engagementRate } from "../../x/types";
import { creativeBlocks } from "../creatives";
import { fail, ok } from "../result";

const PUBLIC_URL = "https://adclone-studio.onrender.com";

function requireSwipeFile(): string | null {
  return isSwipeFileEnabled() ? null : SWIPE_FILE_SETUP_HINT;
}

export function registerMemoryTools(server: McpServer): void {
  /* ---------------------------------------------------------------- *
   * Saving
   * ---------------------------------------------------------------- */

  server.registerTool(
    "save_swipe",
    {
      title: "Save a cloned ad to the swipe file",
      description: [
        "Persist the source ad, the framework you extracted, and the variations you wrote.",
        "",
        "Save AFTER the guards pass, and include each variation's originality, fidelity and spec reports so the record shows what was verified rather than what was hoped.",
        "",
        "Attach creatives by passing each angle's `imageUrl` from generate_image. They are already stored; saving moves them under this record so deleting the swipe removes them too.",
        "",
        "The result says what went on the record. To SHOW it — the copy and the pictures together — call get_swipe afterwards rather than sending the reader to the library.",
      ].join("\n"),
      inputSchema: {
        post: z
          .object({
            id: z.string(),
            url: z.string(),
            author: z.object({ name: z.string(), handle: z.string() }),
            text: z.string().min(1),
            media: z.array(
              z.object({ type: z.enum(["photo", "video"]), url: z.string() }),
            ),
            engagement: z.record(z.string(), z.number().optional()),
            source: z.string(),
          })
          .describe("The object fetch_ad returned."),
        dna: adDnaSchema.describe("The framework you extracted."),
        variations: z
          .array(
            z.object({
              angle: z.string(),
              text: z.string(),
              fields: z
                .record(
                  z.string(),
                  z.union([
                    z.string(),
                    z.array(z.string()),
                    // Carousel cards and thread posts.
                    z.array(z.record(z.string(), z.string())),
                  ]),
                )
                .optional(),
              beatMapping: z
                .array(z.object({ role: z.string(), line: z.string() }))
                .optional(),
              imagePrompt: z.string().optional(),
              imageNegatives: z.string().optional(),
              altText: z.string().optional(),
              rationale: z.string().optional(),
              originality: z.record(z.string(), z.unknown()).optional(),
              fidelity: z.record(z.string(), z.unknown()).optional(),
              spec: z.record(z.string(), z.unknown()).optional(),
              regenerated: z
                .boolean()
                .optional()
                .describe(
                  "True when this draft is the product of a rewrite after a guard flagged it. Defaults to false.",
                ),
            }),
          )
          .min(1),
        platform: z.enum(PLATFORM_IDS as [string, ...string[]]).default("x"),
        format: z
          .string()
          .optional()
          .describe("The format id the copy was written for, e.g. carousel."),
        images: z
          .record(
            z.string(),
            z.object({
              url: z
                .string()
                .optional()
                .describe("The imageUrl generate_image returned. Prefer this."),
              dataUrl: z
                .string()
                .optional()
                .describe("Raw base64, only if you have it to hand."),
              prompt: z.string().optional(),
            }),
          )
          .optional()
          .describe(
            "angle -> creative. Pass the imageUrl from generate_image; it is already stored and will be moved under this swipe.",
          ),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) => {
      const missing = requireSwipeFile();
      if (missing) return fail(missing);

      try {
        const result = await saveSwipe({
          post: args.post as Parameters<typeof saveSwipe>[0]["post"],
          dna: args.dna,
          variations: args.variations as unknown as Parameters<
            typeof saveSwipe
          >[0]["variations"],
          platform: args.platform,
          format: args.format,
          images: args.images,
        });
        /* Show what was saved, rather than pointing at a web page.
         *
         * This used to return an id and a link, which asks the reader to leave
         * the conversation to see work that was just done in it. The copy is
         * already in the transcript; what the reader wants confirmed is that it
         * is now on the record, and with which scores. */
        const saved = args.variations.map((v) => ({
          angle: v.angle,
          originality:
            (v.originality as { score?: number } | undefined)?.score ?? null,
          fidelity: (v.fidelity as { score?: number } | undefined)?.score ?? null,
          creative: args.images?.[v.angle] ? "attached" : "none",
          chars: v.text.length,
        }));

        const withCreative = saved.filter((s) => s.creative === "attached").length;

        return ok({
          id: result.id,
          saved,
          summary: `${args.variations.length} variation${
            args.variations.length === 1 ? "" : "s"
          } saved${withCreative ? ` with ${withCreative} creative${withCreative === 1 ? "" : "s"}` : ", no creatives attached"}.`,
          // Present the copy and the pictures here with get_swipe, rather than
          // sending the reader away to look at them.
          nextStep: `Call get_swipe("${result.id}") to show the full record and its creatives inline.`,
          // A link to THIS run, not to the front door of the library.
          alsoAt: `${PUBLIC_URL}/library?swipe=${result.id}`,
        });
      } catch (err) {
        return fail(describeError(err));
      }
    },
  );

  /* ---------------------------------------------------------------- *
   * Reading
   * ---------------------------------------------------------------- */

  server.registerTool(
    "list_swipes",
    {
      title: "Browse the swipe file",
      description:
        "List saved ads, newest first. Filter by free text (copy, author) or by hook type. Useful for 'what have I already cloned' and for finding a framework worth reusing.",
      inputSchema: {
        query: z.string().optional(),
        hookType: z.string().optional(),
        limit: z.number().int().min(1).max(50).default(20),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, hookType, limit }) => {
      const missing = requireSwipeFile();
      if (missing) return fail(missing);

      try {
        const swipes = await listSwipes({ search: query, hookType, limit });
        return ok(
          swipes.map((s) => ({
            id: s.id,
            author: s.author_handle,
            hookType: s.hook_type,
            savedAt: s.created_at,
            engagement: s.engagement,
            excerpt: s.original_text.slice(0, 200),
            variations: s.clones?.length ?? 0,
          })),
        );
      } catch (err) {
        return fail(describeError(err));
      }
    },
  );

  server.registerTool(
    "get_swipe",
    {
      title: "Read one saved ad in full, creatives included",
      description: [
        "The complete record: source copy, extracted framework, every variation with its originality and fidelity reports, and each creative attached as an image you can look at.",
        "",
        "Use this to SHOW a saved run rather than linking to the library. The pictures come back as image blocks in the reply, so the reader sees the work where the work was done.",
      ].join("\n"),
      inputSchema: {
        id: z.string(),
        withCreatives: z
          .boolean()
          .default(true)
          .describe("Set false for the record alone, when the images are noise."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ id, withCreatives }) => {
      const missing = requireSwipeFile();
      if (missing) return fail(missing);

      try {
        const swipe = await getSwipe(id);
        if (!swipe) return fail(`No saved ad with id ${id}.`);

        const base = ok(swipe);
        if (!withCreatives) return base;

        const blocks = await creativeBlocks(
          (swipe.clones ?? []).map((c) => ({
            label: `${c.angle}${c.image_prompt ? ` — ${c.image_prompt.slice(0, 120)}` : ""}`,
            url: c.image_url,
          })),
        );

        return blocks.length
          ? { ...base, content: [...base.content, ...blocks] }
          : base;
      } catch (err) {
        return fail(describeError(err));
      }
    },
  );

  server.registerTool(
    "delete_swipe",
    {
      title: "Delete a saved ad",
      description:
        "Permanently remove a saved ad, its variations and its creatives. This cannot be undone — confirm with the operator first.",
      inputSchema: { id: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ id }) => {
      const missing = requireSwipeFile();
      if (missing) return fail(missing);

      try {
        await deleteSwipe(id);
        return ok({ deleted: id });
      } catch (err) {
        return fail(describeError(err));
      }
    },
  );

  server.registerTool(
    "get_playbook",
    {
      title: "What the saved ads have in common",
      description: [
        "Aggregate the saved swipe file: dominant hook types, recurring beat structures, persuasion triggers, and which correlate with the highest engagement rate.",
        "",
        "Counted arithmetically from stored data, not summarised by a model — so it can be recomputed and checked. It refuses to claim a pattern below about eight saved ads rather than dressing up a coincidence.",
      ].join("\n"),
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const missing = requireSwipeFile();
      if (missing) return fail(missing);

      try {
        return ok(await buildPlaybook());
      } catch (err) {
        return fail(describeError(err));
      }
    },
  );


  /* ---------------------------------------------------------------- *
   * Grounding
   * ---------------------------------------------------------------- */

  server.registerTool(
    "get_reference_ads",
    {
      title: "The best saved ads of a given shape, as examples to write against",
      description: [
        "Return the highest-engagement saved ads, ranked by engagement RATE rather than raw likes — a 400-like post from a 2,000-follower account outperformed a 4,000-like post from a 500,000-follower one, and raw counts get that backwards.",
        "",
        "Call this BEFORE writing, with the source ad's `hookType`. Three ads that measurably worked in this niche ground the writing in a way no further instruction can: they show the register, the rhythm and the level of specificity that this audience actually responded to.",
        "",
        "Each reference carries its source copy, its structural fingerprint, and the variations that were written from it WITH their originality scores — so you can see which rewrites passed and what they did differently.",
        "",
        "Never copy phrasing from a reference. They are a calibration, not a source: text lifted from one fails check_originality against its own record later, and the guards do not care where a phrase came from.",
        "",
        "Returns an empty list when the swipe file is too thin to be worth quoting. That is a real answer — write without examples rather than treating one saved ad as a pattern.",
      ].join("\n"),
      inputSchema: {
        hookType: z
          .string()
          .optional()
          .describe(
            "Match the source's hook type, e.g. stat-callout, contrarian, listicle-promise.",
          ),
        query: z
          .string()
          .optional()
          .describe("Free text, for narrowing to a niche or product area."),
        limit: z.number().int().min(1).max(5).default(3),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ hookType, query, limit }) => {
      const missing = requireSwipeFile();
      if (missing) return fail(missing);

      try {
        // Pull wide, then rank — the query orders by recency, and recency is
        // not the question being asked here.
        let pool = await listSwipes({ search: query, hookType, limit: 50 });

        // A hook type with nothing in it should fall back rather than return
        // nothing: a well-performing ad of another shape still calibrates tone.
        let widened = false;
        if (pool.length < limit && hookType) {
          pool = await listSwipes({ search: query, limit: 50 });
          widened = true;
        }

        const ranked = pool
          .map((s) => {
            const rate = engagementRate(
              (s.engagement ?? {}) as Parameters<typeof engagementRate>[0],
            );
            return { swipe: s, rate };
          })
          // An ad with no engagement figures cannot be called well-performing.
          .filter((r) => r.rate != null)
          .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0))
          .slice(0, limit);

        const references = ranked.map(({ swipe, rate }) => {
          const passing = (swipe.clones ?? []).filter(
            (c) => c.originality?.pass !== false,
          );

          return {
            id: swipe.id,
            author: swipe.author_handle,
            hookType: swipe.hook_type,
            engagementRatePct:
              rate != null ? Number((rate * 100).toFixed(3)) : null,
            sourceText: swipe.original_text,
            // The fingerprint is the transferable part: what shape this was.
            shape: fingerprint(swipe.original_text),
            whyItWorked: swipe.dna?.whyItWorks ?? null,
            hook: swipe.dna?.hook ?? null,
            variationsThatPassed: passing.map((c) => ({
              angle: c.angle,
              text: c.body,
              originalityScore: c.originality?.score ?? null,
            })),
          };
        });

        return ok({
          count: references.length,
          hookType: hookType ?? null,
          widenedBeyondHookType: widened,
          usage:
            references.length === 0
              ? "Nothing in the swipe file has engagement figures to rank by. Write without references."
              : "Calibrate register, rhythm and specificity against these. Do not reuse their wording.",
          references,
        });
      } catch (err) {
        return fail(describeError(err));
      }
    },
  );

  /* ---------------------------------------------------------------- *
   * ChatGPT's connector contract.
   *
   * Deep Research only surfaces a connector that exposes `search` and
   * `fetch` with these exact names and field shapes. Without them the
   * server appears in ChatGPT and stays unusable there. They are thin
   * views over the swipe file, and useful in their own right.
   * ---------------------------------------------------------------- */

  server.registerTool(
    "search",
    {
      title: "Search saved ads",
      description:
        "Search the swipe file by copy, author or hook type. Returns id, title and url for each match; pass an id to `fetch` for the full record.",
      inputSchema: { query: z.string().describe("Free-text search.") },
      annotations: { readOnlyHint: true },
    },
    async ({ query }) => {
      const missing = requireSwipeFile();
      if (missing) return fail(missing);

      try {
        const swipes = await listSwipes({ search: query, limit: 20 });
        return ok({
          results: swipes.map((s) => ({
            id: s.id,
            title: `@${s.author_handle ?? "unknown"} — ${s.hook_type ?? "ad"}`,
            url: s.source_url || `${PUBLIC_URL}/library`,
          })),
        });
      } catch (err) {
        return fail(describeError(err));
      }
    },
  );

  server.registerTool(
    "fetch",
    {
      title: "Fetch a saved ad by id",
      description:
        "Retrieve one saved ad's full text and metadata by the id returned from `search`.",
      inputSchema: { id: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => {
      const missing = requireSwipeFile();
      if (missing) return fail(missing);

      try {
        const all = await listSwipes({ limit: 50 });
        const swipe = all.find((s) => s.id === id);
        if (!swipe) return fail(`No saved ad with id ${id}.`);

        const clones = (swipe.clones ?? [])
          .map((c) => `## ${c.angle}\n${c.body}`)
          .join("\n\n");

        return ok({
          id: swipe.id,
          title: `@${swipe.author_handle ?? "unknown"} — ${swipe.hook_type ?? "ad"}`,
          text: `# Source\n${swipe.original_text}\n\n# Variations\n${clones}`,
          url: swipe.source_url || `${PUBLIC_URL}/library`,
          metadata: {
            author: swipe.author_handle,
            hookType: swipe.hook_type,
            savedAt: swipe.created_at,
            engagement: swipe.engagement,
          },
        });
      } catch (err) {
        return fail(describeError(err));
      }
    },
  );
}
