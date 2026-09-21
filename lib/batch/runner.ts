import { deconstruct } from "../ai/deconstruct";
import { generateVariations } from "../ai/variations";
import { describeError } from "../ai/errors";
import { getPlatform } from "../platforms";
import { parseAngles } from "../ai/schemas";
import { fetchPost, manualPost } from "../x/fetch-post";
import { saveSwipe } from "../db/swipes";
import {
  claimNextItem,
  completeItem,
  getBatch,
  reclaimStale,
  setBatchStatus,
  settleBatch,
} from "../db/batches";
import type { BatchItem } from "./types";

/**
 * Runs a batch with bounded concurrency.
 *
 * Deliberately reuses the single-ad path untouched — `deconstruct` →
 * `generateVariations` → `saveSwipe`. Bulk is a scheduling problem, not a
 * different pipeline, and forking the logic would mean fixing every bug twice.
 *
 * Concurrency stays low on purpose. The ceiling is the model's rate limit, not
 * CPU: `lib/ai/limiter.ts` already paces per model, so firing twenty workers
 * would just queue twenty callers behind the same bucket while multiplying the
 * memory held in flight.
 */

const running = new Set<string>();

export const DEFAULT_CONCURRENCY = 3;

export function isBatchRunning(batchId: string): boolean {
  return running.has(batchId);
}

async function processItem(
  item: BatchItem,
  ctx: {
    targetPlatform: string;
    angles: string[] | null;
    brand: Parameters<typeof generateVariations>[0]["brand"];
  },
): Promise<void> {
  try {
    const post = item.source_url
      ? await (async () => {
          const result = await fetchPost(item.source_url as string);
          if (!result.ok) throw new Error(result.message);
          return result.post;
        })()
      : manualPost({ text: item.source_text ?? "" });

    if (!post.text.trim()) throw new Error("No text to work from.");

    const { dna } = await deconstruct(post);

    const variations = await generateVariations({
      post,
      dna,
      brand: ctx.brand,
      platform: getPlatform(ctx.targetPlatform),
      selectedAngles: parseAngles(ctx.angles),
    });

    const { id: swipeId } = await saveSwipe({
      post,
      dna,
      variations,
      platform: ctx.targetPlatform,
    });
    await completeItem(item.id, { swipeId });
  } catch (err) {
    // One bad URL must never stall the other forty-nine. Record why and move
    // on; the item can be requeued later without touching the successes.
    await completeItem(item.id, { error: describeError(err) });
  }
}

/**
 * Drain a batch's queue. Resolves when nothing is left to claim.
 *
 * Safe to call twice: the in-process guard stops a duplicate run, and
 * `claimNextItem` uses a conditional update so even two processes cannot take
 * the same item.
 */
export async function runBatch(
  batchId: string,
  opts: { concurrency?: number } = {},
): Promise<void> {
  if (running.has(batchId)) return;
  running.add(batchId);

  try {
    const progress = await getBatch(batchId);
    if (!progress) return;

    // A previous run may have died mid-item — on Render's free plan, a
    // spin-down does exactly that.
    await reclaimStale(batchId);
    await setBatchStatus(batchId, "running");

    const ctx = {
      targetPlatform: progress.batch.target_platform,
      angles: progress.batch.angles ?? null,
      brand: progress.batch.brand_profile,
    };

    const concurrency = Math.max(
      1,
      Math.min(opts.concurrency ?? DEFAULT_CONCURRENCY, 6),
    );

    const worker = async () => {
      for (;;) {
        const item = await claimNextItem(batchId);
        if (!item) return;
        await processItem(item, ctx);
      }
    };

    await Promise.all(Array.from({ length: concurrency }, worker));
    await settleBatch(batchId);
  } finally {
    running.delete(batchId);
  }
}

/**
 * Kick a batch off without making the caller wait for it.
 *
 * The HTTP response returns immediately; on a persistent server (which is why
 * this app is on Render rather than per-request functions) the work carries on
 * in the same process.
 */
export function startBatch(batchId: string, concurrency?: number): void {
  void runBatch(batchId, { concurrency }).catch(async (err) => {
    await setBatchStatus(batchId, "failed").catch(() => {});
    console.error(`[batch ${batchId}]`, describeError(err));
  });
}
