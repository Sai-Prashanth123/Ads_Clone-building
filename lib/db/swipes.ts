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
  regenerated: boolean;
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

async function uploadCreative(
  swipeId: string,
  angle: string,
  dataUrl: string,
): Promise<string | null> {
  const decoded = decodeDataUrl(dataUrl);
  if (!decoded) return null;

  const ext = decoded.mediaType.split("/")[1]?.replace("jpeg", "jpg") ?? "png";
  const path = `${swipeId}/${angle}-${Date.now()}.${ext}`;

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
  images?: Record<string, { dataUrl: string; prompt?: string }>;
  /** Which platform the copy was written for. */
  platform?: string;
}): Promise<{ id: string }> {
  const db = getDb();

  const { data: swipe, error: swipeError } = await db
    .from("swipes")
    .insert({
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
    })
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
      const imageUrl = generated
        ? await uploadCreative(swipe.id, v.angle, generated.dataUrl)
        : null;

      return {
        swipe_id: swipe.id,
        angle: v.angle,
        body: v.text,
        beat_mapping: v.beatMapping,
        image_prompt: generated?.prompt ?? v.imagePrompt,
        image_negatives: v.imageNegatives,
        alt_text: v.altText,
        rationale: v.rationale,
        originality: v.originality,
        spec_report: v.spec ?? null,
        fields: v.fields ?? null,
        target_platform: args.platform ?? "x",
        regenerated: v.regenerated,
        image_url: imageUrl,
      };
    }),
  );

  const { error: clonesError } = await db.from("clones").insert(rows);
  if (clonesError) throw new Error(clonesError.message);

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
      "id, created_at, source_url, author_handle, author_name, original_text, original_media_url, engagement, dna, hook_type, clones(*)",
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

export async function deleteSwipe(id: string): Promise<void> {
  const db = getDb();

  // Object storage is not covered by the foreign key, so the creatives must be
  // removed explicitly or they linger in the bucket forever. Storage first:
  // an orphaned row is recoverable, an orphaned blob is invisible.
  const { data: files } = await db.storage.from(CREATIVES_BUCKET).list(id);
  if (files?.length) {
    await db.storage
      .from(CREATIVES_BUCKET)
      .remove(files.map((f) => `${id}/${f.name}`));
  }

  // clones cascade via the foreign key.
  const { error } = await db.from("swipes").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
