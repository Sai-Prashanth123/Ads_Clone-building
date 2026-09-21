import { getDb } from "./client";
import {
  isTerminal,
  tallyItems,
  type Batch,
  type BatchItem,
  type BatchProgress,
} from "../batch/types";
import type { PlatformId } from "../platforms";
import type { BrandProfile } from "../ai/schemas";

export type NewBatchInput = {
  label?: string;
  targetPlatform: PlatformId;
  brand?: BrandProfile | null;
  angles?: string[];
  sources: { url?: string; text?: string }[];
};

export async function createBatch(input: NewBatchInput): Promise<Batch> {
  const db = getDb();

  const { data: batch, error } = await db
    .from("batches")
    .insert({
      label: input.label ?? null,
      target_platform: input.targetPlatform,
      brand_profile: input.brand ?? null,
      ...(input.angles?.length ? { angles: input.angles } : {}),
    })
    .select("*")
    .single();

  if (error || !batch) throw new Error(error?.message ?? "Could not create batch.");

  const rows = input.sources.map((s, i) => ({
    batch_id: batch.id,
    position: i,
    source_url: s.url ?? null,
    source_text: s.text ?? null,
  }));

  const { error: itemsError } = await db.from("batch_items").insert(rows);
  if (itemsError) {
    // Leaving a batch with no items would show as a permanently empty run.
    await db.from("batches").delete().eq("id", batch.id);
    throw new Error(itemsError.message);
  }

  return batch as Batch;
}

export async function getBatch(id: string): Promise<BatchProgress | null> {
  const db = getDb();

  const { data: batch } = await db
    .from("batches")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!batch) return null;

  const { data: items } = await db
    .from("batch_items")
    .select("*")
    .eq("batch_id", id)
    .order("position", { ascending: true });

  const list = (items ?? []) as BatchItem[];
  return { batch: batch as Batch, items: list, totals: tallyItems(list) };
}

export async function listBatches(limit = 30): Promise<
  (Batch & { total: number; done: number; failed: number })[]
> {
  const db = getDb();

  const { data, error } = await db
    .from("batches")
    .select("*, batch_items(status)")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => {
    const items = (row.batch_items ?? []) as { status: string }[];
    return {
      ...(row as Batch),
      total: items.length,
      done: items.filter((i) => i.status === "done").length,
      failed: items.filter((i) => i.status === "failed").length,
    };
  });
}

/**
 * Claim the next queued item for this batch.
 *
 * The status filter in the update is the lock: two workers racing for the same
 * row means only one update matches `status = 'queued'`, and the loser gets no
 * row back rather than a duplicate clone.
 */
export async function claimNextItem(batchId: string): Promise<BatchItem | null> {
  const db = getDb();

  const { data: candidate } = await db
    .from("batch_items")
    .select("id")
    .eq("batch_id", batchId)
    .eq("status", "queued")
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!candidate) return null;

  const { data: claimed } = await db
    .from("batch_items")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", candidate.id)
    .eq("status", "queued")
    .select("*")
    .maybeSingle();

  return (claimed as BatchItem) ?? null;
}

export async function completeItem(
  id: string,
  result: { swipeId?: string; error?: string },
): Promise<void> {
  await getDb()
    .from("batch_items")
    .update({
      status: result.error ? "failed" : "done",
      error: result.error ?? null,
      swipe_id: result.swipeId ?? null,
      finished_at: new Date().toISOString(),
    })
    .eq("id", id);
}

export async function setBatchStatus(
  id: string,
  status: Batch["status"],
): Promise<void> {
  await getDb()
    .from("batches")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
}

/** Recompute terminal state from the items, rather than trusting a counter. */
export async function settleBatch(id: string): Promise<void> {
  const progress = await getBatch(id);
  if (!progress) return;

  if (!isTerminal(progress.totals)) return;

  const allFailed =
    progress.totals.done === 0 && progress.totals.failed > 0;
  await setBatchStatus(id, allFailed ? "failed" : "done");
}

/** Put failed items back in the queue so a retry picks up only those. */
export async function requeueFailed(batchId: string): Promise<number> {
  const db = getDb();

  const { data } = await db
    .from("batch_items")
    .update({ status: "queued", error: null, finished_at: null })
    .eq("batch_id", batchId)
    .eq("status", "failed")
    .select("id");

  const count = data?.length ?? 0;
  if (count > 0) await setBatchStatus(batchId, "queued");
  return count;
}

/** Items left stuck in `running` after a restart or a spin-down. */
export async function reclaimStale(
  batchId: string,
  olderThanMs = 10 * 60_000,
): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();

  const { data } = await getDb()
    .from("batch_items")
    .update({ status: "queued", started_at: null })
    .eq("batch_id", batchId)
    .eq("status", "running")
    .lt("started_at", cutoff)
    .select("id");

  return data?.length ?? 0;
}
