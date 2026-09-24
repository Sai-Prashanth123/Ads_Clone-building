import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { isSwipeFileEnabled, SWIPE_FILE_SETUP_HINT } from "../../db/client";
import { createBatch, getBatch, requeueFailed } from "../../db/batches";
import { isBatchRunning, startBatch } from "../../batch/runner";
import { detectProvider } from "../../ai/provider";
import { describeError } from "../../ai/errors";
import { PLATFORM_IDS } from "../../platforms";
import { fail, ok } from "../result";

/**
 * Unattended batching — the one thing that still needs a server-side model.
 *
 * Everything else here is host-driven, which is the point of the MCP design.
 * But a fifty-ad run cannot live inside a conversation: it outlasts the
 * context, and the operator wants to close the tab. That needs a worker with
 * its own model, so these tools exist only when a provider key is configured.
 *
 * When it is not, they say so and point at the host-driven path rather than
 * failing obscurely — a queue that accepts work it cannot process is worse
 * than one that refuses it.
 */

const NO_PROVIDER = [
  "Unattended batching needs a server-side model, and none is configured (set GOOGLE_GENERATIVE_AI_API_KEY).",
  "",
  "For a handful of ads, do it yourself instead: call fetch_ads with the URLs, then work through them one at a time. That keeps everything in this conversation and needs no key.",
].join("\n");

function serverSideAvailable(): boolean {
  return detectProvider() !== null;
}

export function registerBatchTools(server: McpServer): void {
  server.registerTool(
    "create_batch",
    {
      title: "Queue an unattended bulk run",
      description: [
        "Queue many ads to be cloned by the server, without a conversation attached.",
        "",
        "Work continues after this returns — poll get_batch for progress. Only worth it beyond roughly twenty ads; below that, fetch_ads and working through them yourself gives better copy, because you can iterate against the guards.",
        "",
        "Requires a server-side model key. Throughput is capped near fifteen ads a minute by free-tier rate limits.",
      ].join("\n"),
      inputSchema: {
        urls: z.array(z.string()).min(1).max(100),
        targetPlatform: z.enum(PLATFORM_IDS as [string, ...string[]]).default("x"),
        label: z.string().max(120).optional(),
        angles: z.array(z.string()).max(8).optional(),
        concurrency: z.number().int().min(1).max(6).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ urls, targetPlatform, label, angles, concurrency }) => {
      const missing = isSwipeFileEnabled() ? null : SWIPE_FILE_SETUP_HINT;
      if (missing) return fail(missing);
      if (!serverSideAvailable()) return fail(NO_PROVIDER);

      try {
        const batch = await createBatch({
          label,
          targetPlatform: targetPlatform as "x",
          angles,
          sources: urls.map((url) => ({ url })),
        });

        startBatch(batch.id, concurrency);

        return ok({
          id: batch.id,
          queued: urls.length,
          note: "Processing started. Poll get_batch for progress.",
        });
      } catch (err) {
        return fail(describeError(err));
      }
    },
  );

  server.registerTool(
    "get_batch",
    {
      title: "Check a bulk run's progress",
      description:
        "Per-item status for a queued run. Items that failed carry their reason; the rest continue regardless.",
      inputSchema: { id: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => {
      const missing = isSwipeFileEnabled() ? null : SWIPE_FILE_SETUP_HINT;
      if (missing) return fail(missing);

      try {
        const progress = await getBatch(id);
        if (!progress) return fail(`No batch with id ${id}.`);

        return ok({
          id: progress.batch.id,
          label: progress.batch.label,
          status: progress.batch.status,
          targetPlatform: progress.batch.target_platform,
          running: isBatchRunning(id),
          totals: progress.totals,
          items: progress.items.map((i) => ({
            position: i.position + 1,
            source: i.source_url ?? i.source_text?.slice(0, 80),
            status: i.status,
            swipeId: i.swipe_id,
            error: i.error,
          })),
        });
      } catch (err) {
        return fail(describeError(err));
      }
    },
  );

  server.registerTool(
    "retry_failed_batch_items",
    {
      title: "Retry a run's failures",
      description:
        "Requeue only the failed items and resume. Also the way to restart a run whose worker died — on a free-tier host that happens when the service sleeps mid-run.",
      inputSchema: { id: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ id }) => {
      const missing = isSwipeFileEnabled() ? null : SWIPE_FILE_SETUP_HINT;
      if (missing) return fail(missing);
      if (!serverSideAvailable()) return fail(NO_PROVIDER);

      try {
        const requeued = await requeueFailed(id);
        startBatch(id);
        return ok({ requeued, resumed: true });
      } catch (err) {
        return fail(describeError(err));
      }
    },
  );
}
