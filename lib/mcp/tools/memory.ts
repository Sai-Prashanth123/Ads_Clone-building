import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { isSwipeFileEnabled, SWIPE_FILE_SETUP_HINT } from "../../db/client";
import { deleteSwipe, listSwipes, saveSwipe } from "../../db/swipes";
import { buildPlaybook } from "../../analysis/playbook";
import { describeError } from "../../ai/errors";
import { adDnaSchema } from "../../ai/schemas";
import { PLATFORM_IDS } from "../../platforms";
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
        "Save AFTER the guards pass. Include each variation's originality and spec reports so the record shows what was verified rather than what was hoped.",
        "",
        "Pass a creative's `dataUrl` from generate_image to store the image alongside its copy.",
        "",
        `Saved runs appear at ${PUBLIC_URL}/library and feed get_playbook.`,
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
                .record(z.string(), z.union([z.string(), z.array(z.string())]))
                .optional(),
              beatMapping: z
                .array(z.object({ role: z.string(), line: z.string() }))
                .optional(),
              imagePrompt: z.string().optional(),
              imageNegatives: z.string().optional(),
              altText: z.string().optional(),
              rationale: z.string().optional(),
              originality: z.record(z.string(), z.unknown()).optional(),
              spec: z.record(z.string(), z.unknown()).optional(),
            }),
          )
          .min(1),
        platform: z.enum(PLATFORM_IDS as [string, ...string[]]).default("x"),
        images: z
          .record(z.string(), z.object({ dataUrl: z.string(), prompt: z.string().optional() }))
          .optional()
          .describe("angle -> creative from generate_image."),
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
          images: args.images,
        });
        return ok({
          id: result.id,
          savedVariations: args.variations.length,
          viewAt: `${PUBLIC_URL}/library`,
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
      title: "Read one saved ad in full",
      description:
        "The complete record: source copy, extracted framework, every variation with its originality and spec reports, and any creative that was generated.",
      inputSchema: { id: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => {
      const missing = requireSwipeFile();
      if (missing) return fail(missing);

      try {
        const [swipe] = await listSwipes({ limit: 50 }).then((all) =>
          all.filter((s) => s.id === id),
        );
        return swipe ? ok(swipe) : fail(`No saved ad with id ${id}.`);
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
