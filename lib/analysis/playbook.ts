import { getDb } from "../db/client";
import { engagementRate } from "../x/types";
import type { AdDna } from "../ai/schemas";

/**
 * What the swipe file knows once it has enough ads in it.
 *
 * This is the payoff for storing the DNA rather than just the output: with
 * thirty ads the interesting question stops being "what does this ad do" and
 * becomes "what do the ads that work in my niche have in common".
 *
 * Deliberately arithmetic, not a model call. Counting hook types is something
 * SQL and a reduce do exactly right, and a summary that can be recomputed and
 * checked beats one that has to be trusted.
 */

export type Tally = {
  key: string;
  count: number;
  share: number;
  /** Mean engagement rate of the ads in this bucket, where views are known. */
  avgEngagement: number | null;
};

export type Playbook = {
  sampleSize: number;
  /** How many carried view counts, so the averages can be judged. */
  measured: number;
  hooks: Tally[];
  structures: Tally[];
  triggers: Tally[];
  proofTypes: Tally[];
  formats: { withImage: number; textOnly: number };
  /** Highest engagement rate first. */
  topPerformers: {
    id: string;
    author: string | null;
    hook: string | null;
    engagementRate: number | null;
    excerpt: string;
  }[];
  /** Only stated where the sample is big enough to mean anything. */
  findings: string[];
};

type Row = {
  id: string;
  author_handle: string | null;
  original_text: string;
  original_media_url: string | null;
  engagement: Record<string, number> | null;
  dna: AdDna;
  hook_type: string | null;
};

/** Count occurrences and attach the mean engagement of each bucket. */
function tally(
  rows: Row[],
  pick: (row: Row) => string[] | string | null | undefined,
): Tally[] {
  const buckets = new Map<string, { count: number; rates: number[] }>();

  for (const row of rows) {
    const picked = pick(row);
    const keys = Array.isArray(picked) ? picked : picked ? [picked] : [];
    const rate = engagementRate(row.engagement ?? {});

    for (const raw of keys) {
      const key = raw.trim().toLowerCase();
      if (!key) continue;
      const bucket = buckets.get(key) ?? { count: 0, rates: [] };
      bucket.count++;
      if (rate != null) bucket.rates.push(rate);
      buckets.set(key, bucket);
    }
  }

  const total = rows.length || 1;

  return [...buckets.entries()]
    .map(([key, { count, rates }]) => ({
      key,
      count,
      share: count / total,
      avgEngagement: rates.length
        ? rates.reduce((a, b) => a + b, 0) / rates.length
        : null,
    }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Only claim a pattern when the sample can carry it. Two ads sharing a hook is
 * a coincidence; the point of this report is to avoid dressing one up as a
 * finding.
 */
const MIN_SAMPLE = 8;
const MIN_BUCKET = 3;

function deriveFindings(
  rows: Row[],
  hooks: Tally[],
  triggers: Tally[],
): string[] {
  if (rows.length < MIN_SAMPLE) {
    return [
      `Only ${rows.length} ads saved. Patterns are not worth reading below about ${MIN_SAMPLE} — save more runs first.`,
    ];
  }

  const findings: string[] = [];
  const top = hooks[0];

  if (top && top.count >= MIN_BUCKET) {
    findings.push(
      `${Math.round(top.share * 100)}% of your saved ads open with a ${top.key.replace(/-/g, " ")} hook.`,
    );
  }

  // Which hook actually performs, as opposed to which one you collect most.
  const measured = hooks.filter(
    (h) => h.avgEngagement != null && h.count >= MIN_BUCKET,
  );
  if (measured.length >= 2) {
    const best = measured.reduce((a, b) =>
      (b.avgEngagement ?? 0) > (a.avgEngagement ?? 0) ? b : a,
    );
    findings.push(
      `${best.key.replace(/-/g, " ")} hooks average ${((best.avgEngagement ?? 0) * 100).toFixed(2)}% engagement — the strongest in your file.`,
    );
    if (top && best.key !== top.key) {
      findings.push(
        `You collect ${top.key.replace(/-/g, " ")} most, but ${best.key.replace(/-/g, " ")} performs better. Worth testing more of the latter.`,
      );
    }
  }

  const topTrigger = triggers[0];
  if (topTrigger && topTrigger.count >= MIN_BUCKET) {
    findings.push(
      `"${topTrigger.key}" is the most recurring psychological lever, in ${topTrigger.count} of ${rows.length} ads.`,
    );
  }

  const withImage = rows.filter((r) => r.original_media_url).length;
  if (withImage && withImage !== rows.length) {
    findings.push(
      `${Math.round((withImage / rows.length) * 100)}% carry a creative; the rest win on copy alone.`,
    );
  }

  return findings;
}

export async function buildPlaybook(limit = 200): Promise<Playbook> {
  const { data, error } = await getDb()
    .from("swipes")
    .select(
      "id, author_handle, original_text, original_media_url, engagement, dna, hook_type",
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as Row[];

  const hooks = tally(rows, (r) => r.hook_type ?? r.dna?.hook?.type);
  const structures = tally(rows, (r) =>
    r.dna?.structure?.beats?.map((b) => b.role).join(" > "),
  );
  const triggers = tally(rows, (r) => r.dna?.persuasion?.triggers ?? []);
  const proofTypes = tally(rows, (r) => r.dna?.persuasion?.proofType);

  const topPerformers = rows
    .map((r) => ({
      id: r.id,
      author: r.author_handle,
      hook: r.hook_type,
      engagementRate: engagementRate(r.engagement ?? {}),
      excerpt: r.original_text.slice(0, 140),
    }))
    .filter((r) => r.engagementRate != null)
    .sort((a, b) => (b.engagementRate ?? 0) - (a.engagementRate ?? 0))
    .slice(0, 8);

  return {
    sampleSize: rows.length,
    measured: rows.filter((r) => engagementRate(r.engagement ?? {}) != null).length,
    hooks,
    structures: structures.slice(0, 8),
    triggers: triggers.slice(0, 12),
    proofTypes,
    formats: {
      withImage: rows.filter((r) => r.original_media_url).length,
      textOnly: rows.filter((r) => !r.original_media_url).length,
    },
    topPerformers,
    findings: deriveFindings(rows, hooks, triggers),
  };
}
