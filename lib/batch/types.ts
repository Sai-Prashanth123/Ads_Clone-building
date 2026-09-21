import type { PlatformId } from "../platforms";
import type { BrandProfile } from "../ai/schemas";

export type BatchStatus = "queued" | "running" | "done" | "failed" | "cancelled";
export type ItemStatus = "queued" | "running" | "done" | "failed" | "skipped";

export type BatchItem = {
  id: string;
  batch_id: string;
  position: number;
  source_url: string | null;
  source_text: string | null;
  status: ItemStatus;
  attempts: number;
  error: string | null;
  swipe_id: string | null;
  started_at: string | null;
  finished_at: string | null;
};

export type Batch = {
  id: string;
  created_at: string;
  updated_at: string;
  label: string | null;
  target_platform: PlatformId;
  brand_profile: BrandProfile | null;
  angles: string[];
  status: BatchStatus;
};

export type BatchProgress = {
  batch: Batch;
  items: BatchItem[];
  totals: Record<ItemStatus, number>;
};

export function tallyItems(items: BatchItem[]): Record<ItemStatus, number> {
  const totals: Record<ItemStatus, number> = {
    queued: 0,
    running: 0,
    done: 0,
    failed: 0,
    skipped: 0,
  };
  for (const item of items) totals[item.status]++;
  return totals;
}

/**
 * A batch is finished when nothing is left to do — including when every
 * remaining item failed. "All failed" is still a terminal state, and leaving
 * it as `running` forever is how a progress bar lies.
 */
export function isTerminal(totals: Record<ItemStatus, number>): boolean {
  return totals.queued === 0 && totals.running === 0;
}
