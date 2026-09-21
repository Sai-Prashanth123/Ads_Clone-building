import { generateObject } from "ai";
import { getAnalysisModels } from "./provider";
import { withModelFallback } from "./retry";
import { adDnaSchema, type AdDna } from "./schemas";
import { DECONSTRUCT_SYSTEM, deconstructPrompt } from "./prompts";
import type { SourcePost } from "../x/types";

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

/**
 * Fetch the creative so the model sees the actual pixels. Passing the URL
 * alone would have the provider fetch it, and pbs.twimg.com is inconsistent
 * about serving non-browser clients.
 */
async function loadImage(
  url: string,
): Promise<{ data: Uint8Array; mediaType: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AdCloneStudio/1.0)" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;

    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > MAX_IMAGE_BYTES) return null;

    const mediaType = res.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
    if (!mediaType.startsWith("image/")) return null;

    return { data: buf, mediaType };
  } catch {
    return null;
  }
}

export async function deconstruct(
  post: SourcePost,
  onProgress?: (message: string) => void,
): Promise<{
  dna: AdDna;
  imageAnalysed: boolean;
}> {
  const photo = post.media.find((m) => m.type === "photo") ?? post.media[0];
  const image = photo ? await loadImage(photo.url) : null;

  const { object } = await withModelFallback(
    getAnalysisModels(),
    ({ model }) =>
      generateObject({
        model,
        schema: adDnaSchema,
        system: DECONSTRUCT_SYSTEM,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: deconstructPrompt(post) },
              // v7: the `image` part is deprecated in favour of a `file` part.
              ...(image
                ? [
                    {
                      type: "file" as const,
                      mediaType: image.mediaType,
                      data: image.data,
                    },
                  ]
                : []),
            ],
          },
        ],
      }),
    {
      onRetry: (attempt, delayMs) =>
        onProgress?.(
          `Provider was busy — waiting ${Math.round(delayMs / 1000)}s (attempt ${attempt + 1})`,
        ),
      onFallback: (from, to) =>
        onProgress?.(`${from} is rate-limited — switching to ${to}`),
    },
  );

  // The model is told to null this out when there is no creative, but a post
  // whose image we failed to load must not get an invented visual read.
  const dna = image ? object : { ...object, visual: null };

  return { dna, imageAnalysed: Boolean(image) };
}
