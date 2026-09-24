import type { CallToolResult } from "@modelcontextprotocol/server";

/**
 * Putting saved creatives back into the conversation.
 *
 * A saved run used to come back as an id and a link to /library, which asks the
 * reader to leave the conversation to see work that was just done in it. The
 * copy is already in the transcript; the picture was the one part that was not,
 * and it is the part a link is worst at replacing.
 *
 * So the images are fetched and attached as content blocks. That costs bytes,
 * which is why it is bounded: a handful of creatives, a size ceiling each, and
 * a skip rather than a failure when one cannot be read.
 */

const MAX_IMAGES = 6;
const MAX_BYTES = 4 * 1024 * 1024;

export type Creative = { label: string; url: string | null };

/** Fetch one creative, or null when it cannot be shown. */
async function loadOne(
  url: string,
): Promise<{ base64: string; mediaType: string } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return null;

    const mediaType = res.headers.get("content-type")?.split(";")[0] ?? "";
    if (!mediaType.startsWith("image/")) return null;

    const bytes = Buffer.from(await res.arrayBuffer());
    if (!bytes.byteLength || bytes.byteLength > MAX_BYTES) return null;

    return { base64: bytes.toString("base64"), mediaType };
  } catch {
    // A creative that will not load is worth a missing picture, not a failure.
    return null;
  }
}

/**
 * Content blocks for as many creatives as are worth sending.
 *
 * Each image is labelled by the line before it, because several images in a row
 * are otherwise unattributable — the reader cannot tell which angle is which.
 */
export async function creativeBlocks(
  creatives: Creative[],
): Promise<CallToolResult["content"]> {
  const withUrls = creatives
    .filter((c): c is { label: string; url: string } => Boolean(c.url))
    .slice(0, MAX_IMAGES);

  const loaded = await Promise.all(
    withUrls.map(async (c) => ({ ...c, image: await loadOne(c.url) })),
  );

  const blocks: CallToolResult["content"] = [];

  for (const c of loaded) {
    if (!c.image) continue;
    blocks.push({ type: "text", text: c.label });
    blocks.push({
      type: "image",
      data: c.image.base64,
      mimeType: c.image.mediaType,
    });
  }

  return blocks;
}
