import { CREATIVES_BUCKET, getDb } from "./client";
import type { AdDna } from "../ai/schemas";
import type { ScoredVariation } from "../ai/variations";
import type { SourcePost } from "../x/types";

export type SavedClone = {
  id: string;
  angle: string;
  body: string;
  rationale: string | null;
  image_prompt: string | null;
  image_url: string | null;
  image_model: string | null;
  alt_text: string | null;
  originality: { score?: number; pass?: boolean } | null;
  fidelity: { score?: number; pass?: boolean; drifted?: string[] } | null;
  regenerated: boolean;
  target_format: string | null;
  /** The platform-shaped copy, when the run was written for one. */
  fields: Record<string, unknown> | null;
  beat_mapping: { role: string; line: string }[] | null;
};

export type SavedSwipe = {
  id: string;
  created_at: string;
  source_url: string | null;
  author_handle: string | null;
  author_name: string | null;
  original_text: string;
  original_media_url: string | null;
  engagement: Record<string, number> | null;
  dna: AdDna;
  hook_type: string | null;
  platform: string | null;
  target_format: string | null;
  clones: SavedClone[];
};

/** Turn a data: URL into bytes for object storage. */
function decodeDataUrl(
  dataUrl: string,
): { bytes: Uint8Array; mediaType: string } | null {
  // [\s\S] rather than the `s` flag — the tsconfig target predates it.
  const match = /^data:([^;]+);base64,([\s\S]+)$/.exec(dataUrl);
  if (!match) return null;
  try {
    return {
      mediaType: match[1],
      bytes: Uint8Array.from(Buffer.from(match[2], "base64")),
    };
  } catch {
    return null;
  }
}

const PENDING = "pending";

function extensionFor(mediaType: string): string {
  return mediaType.split("/")[1]?.replace("jpeg", "jpg") ?? "png";
}

/**
 * Store a creative that has no swipe yet, and return a URL.
 *
 * generate_image used to hand the image back as base64 in structuredContent.
 * Most MCP clients surface only the content blocks to the model, so the caller
 * could see the picture and had no way to reference it — which made an image
 * impossible to save over MCP at all. A URL is short enough to carry through a
 * conversation and back into save_swipe.
 */
export async function stageCreative(
  dataUrl: string,
): Promise<{ url: string; path: string } | null> {
  const decoded = decodeDataUrl(dataUrl);
  if (!decoded) return null;

  const path = `${PENDING}/${crypto.randomUUID()}.${extensionFor(decoded.mediaType)}`;

  const { error } = await getDb()
    .storage.from(CREATIVES_BUCKET)
    .upload(path, decoded.bytes, {
      contentType: decoded.mediaType,
      upsert: true,
    });

  if (error) return null;

  const { data } = getDb().storage.from(CREATIVES_BUCKET).getPublicUrl(path);
  return data.publicUrl ? { url: data.publicUrl, path } : null;
}

/**
 * Move a staged creative under its swipe, so deleting the swipe still removes
 * it. A failed move keeps the staged URL rather than losing the picture.
 */
async function adoptStaged(
  swipeId: string,
  angle: string,
  url: string,
): Promise<string> {
  const marker = `/${CREATIVES_BUCKET}/${PENDING}/`;
  const at = url.indexOf(marker);
  if (at < 0) return url;

  const from = `${PENDING}/${url.slice(at + marker.length).split("?")[0]}`;
  const ext = from.split(".").pop() ?? "png";
  const to = `${swipeId}/${angle}-${Date.now()}.${ext}`;

  const { error } = await getDb().storage.from(CREATIVES_BUCKET).move(from, to);

  if (error) return url;

  const { data } = getDb().storage.from(CREATIVES_BUCKET).getPublicUrl(to);
  return data.publicUrl ?? url;
}

async function uploadCreative(
  swipeId: string,
  angle: string,
  dataUrl: string,
): Promise<string | null> {
  const decoded = decodeDataUrl(dataUrl);
  if (!decoded) return null;

  const path = `${swipeId}/${angle}-${Date.now()}.${extensionFor(decoded.mediaType)}`;

  const { error } = await getDb()
    .storage.from(CREATIVES_BUCKET)
    .upload(path, decoded.bytes, {
      contentType: decoded.mediaType,
      upsert: true,
    });

  if (error) return null;

  const { data } = getDb().storage.from(CREATIVES_BUCKET).getPublicUrl(path);
  return data.publicUrl ?? null;
}

/**
 * Drop keys whose value is undefined, so the column's own default applies.
 *
 * PostgREST sends an explicit null for an undefined property, and an explicit
 * null OVERRIDES a column default — so a NOT NULL column with a perfectly good
 * default still fails. Every optional field in the MCP tool's schema is a
 * candidate: `regenerated`, `originality` and `beat_mapping` each broke this
 * way in turn, one deploy apart. Defaulting them one at a time only finds the
 * next one in production, so the row is cleaned as a whole.
 */
function withoutUndefined<T extends Record<string, unknown>>(
  row: T,
): Partial<T> {
  return Object.fromEntries(
    Object.entries(row).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

export async function saveSwipe(args: {
  post: SourcePost;
  dna: AdDna;
  variations: ScoredVariation[];
  /**
   * angle -> the creative generated this session, plus the prompt that made
   * it. The prompt may have been edited on the card, so it is recorded rather
   * than the model's original — otherwise the row claims a prompt that never
   * produced anything.
   */
  images?: Record<string, { dataUrl?: string; url?: string; prompt?: string }>;
  /** Which platform the copy was written for. */
  platform?: string;
  /** Which of that platform's formats — carousel, thread, RSA, story. */
  format?: string;
}): Promise<{ id: string }> {
  const db = getDb();

  const { data: swipe, error: swipeError } = await db
    .from("swipes")
    .insert(
      withoutUndefined({
        source_url: args.post.url || null,
        tweet_id: args.post.id,
        author_handle: args.post.author.handle,
        author_name: args.post.author.name,
        original_text: args.post.text,
        original_media_url: args.post.media[0]?.url ?? null,
        engagement: args.post.engagement,
        dna: args.dna,
        fetched_via: args.post.source,
        platform: args.platform ?? "x",
        target_format: args.format ?? null,
      }),
    )
    .select("id")
    .single();

  if (swipeError || !swipe) {
    throw new Error(swipeError?.message ?? "Could not save the swipe.");
  }

  // Images are uploaded in parallel; a failed upload costs the picture, not
  // the saved record.
  const rows = await Promise.all(
    args.variations.map(async (v) => {
      const generated = args.images?.[v.angle];

      /* Take the creative however it arrives.
       *
       * A host working from a cached tool list only knows about `dataUrl`, so
       * it puts the hosted URL there — and decoding that as base64 failed
       * silently, losing the picture. Which field it came in matters far less
       * than not dropping it. */
      const raw = generated?.dataUrl ?? generated?.url;
      const isHostedUrl = Boolean(raw && /^https?:\/\//i.test(raw));

      const imageUrl = !raw
        ? null
        : isHostedUrl
          ? await adoptStaged(swipe.id, v.angle, raw)
          : await uploadCreative(swipe.id, v.angle, raw);

      return withoutUndefined({
        swipe_id: swipe.id,
        angle: v.angle,
        body: v.text,
        beat_mapping: v.beatMapping,
        image_prompt: generated?.prompt ?? v.imagePrompt,
        image_negatives: v.imageNegatives,
        alt_text: v.altText,
        rationale: v.rationale,
        originality: v.originality,
        fidelity: v.fidelity ?? null,
        spec_report: v.spec ?? null,
        fields: v.fields ?? null,
        target_platform: args.platform ?? "x",
        target_format: args.format ?? null,
        regenerated: v.regenerated ?? false,
        image_url: imageUrl,
      });
    }),
  );

  const { error: clonesError } = await db.from("clones").insert(rows);

  if (clonesError) {
    /* Roll the swipe back.
     *
     * Without this a failed clone insert left a source-only record in the
     * library with zero variations, and a caller retrying the save left one
     * per attempt. The swipe alone is not a useful record of anything. */
    await db.from("swipes").delete().eq("id", swipe.id);
    throw new Error(clonesError.message);
  }

  return { id: swipe.id };
}

export async function listSwipes(opts: {
  search?: string;
  hookType?: string;
  limit?: number;
}): Promise<SavedSwipe[]> {
  let query = getDb()
    .from("swipes")
    .select(
      "id, created_at, source_url, author_handle, author_name, original_text, original_media_url, engagement, dna, hook_type, platform, target_format, clones(*)",
    )
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 50);

  if (opts.hookType) query = query.eq("hook_type", opts.hookType);

  if (opts.search?.trim()) {
    // Escape PostgREST's or() delimiters before interpolating user input.
    const term = opts.search.trim().replace(/[,()]/g, " ");
    query = query.or(
      `original_text.ilike.%${term}%,author_handle.ilike.%${term}%,author_name.ilike.%${term}%`,
    );
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return (data ?? []) as unknown as SavedSwipe[];
}

/** The object path inside our bucket, for a URL that points at it. */
function objectPathOf(url: string): string | null {
  const marker = `/${CREATIVES_BUCKET}/`;
  const at = url.indexOf(marker);
  return at < 0 ? null : url.slice(at + marker.length).split("?")[0];
}

/**
 * One saved run, by id.
 *
 * Read directly rather than by filtering a listing: the listing is capped, so
 * scanning it made every record older than the most recent fifty unreachable —
 * and silently, as "no saved ad with that id".
 */
export async function getSwipe(id: string): Promise<SavedSwipe | null> {
  const { data, error } = await getDb()
    .from("swipes")
    .select(
      "id, created_at, source_url, author_handle, author_name, original_text, original_media_url, engagement, dna, hook_type, platform, target_format, clones(*)",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as unknown as SavedSwipe) ?? null;
}

export async function deleteSwipe(id: string): Promise<void> {
  const db = getDb();

  /* Object storage is not covered by the foreign key, so creatives must be
   * removed explicitly or they linger in the bucket forever. Storage first: an
   * orphaned row is recoverable, an orphaned blob is invisible.
   *
   * Two places to look. The swipe's own folder is where a creative ends up
   * once it has been moved out of staging — and that move can fail, silently
   * and for reasons outside this code, in which case the record still points
   * at the staged copy. Following the stored URLs covers both, so a failed
   * move costs a tidy path rather than a leaked file. */
  const paths = new Set<string>();

  const { data: files } = await db.storage.from(CREATIVES_BUCKET).list(id);
  for (const f of files ?? []) paths.add(`${id}/${f.name}`);

  const { data: clones } = await db
    .from("clones")
    .select("image_url")
    .eq("swipe_id", id);

  for (const c of (clones ?? []) as { image_url: string | null }[]) {
    const path = c.image_url ? objectPathOf(c.image_url) : null;
    if (path) paths.add(path);
  }

  if (paths.size) {
    await db.storage.from(CREATIVES_BUCKET).remove([...paths]);
  }

  // clones cascade via the foreign key.
  const { error } = await db.from("swipes").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
