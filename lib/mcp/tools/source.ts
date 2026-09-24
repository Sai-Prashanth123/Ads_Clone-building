import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { fetchPost, manualPost } from "../../x/fetch-post";
import { engagementRate, type SourcePost } from "../../x/types";
import { fail, ok } from "../result";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Pull the creative down so the HOST can look at it.
 *
 * This is the pivot of the whole design. The old pipeline fetched these bytes
 * and posted them to Gemini; now they go back to the caller as an image content
 * block, and Claude or ChatGPT reads the ad with its own eyes. The vision pass
 * stops being a thing this server buys and becomes a thing the host already has.
 */
async function loadCreative(
  url: string,
): Promise<{ base64: string; mediaType: string } | null> {
  try {
    if (url.startsWith("data:")) {
      const match = /^data:([^;]+);base64,([\s\S]+)$/.exec(url);
      return match ? { mediaType: match[1], base64: match[2] } : null;
    }

    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AdCloneMCP/1.0)" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;

    const bytes = Buffer.from(await res.arrayBuffer());
    if (!bytes.byteLength || bytes.byteLength > MAX_IMAGE_BYTES) return null;

    const mediaType = res.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
    if (!mediaType.startsWith("image/")) return null;

    return { base64: bytes.toString("base64"), mediaType };
  } catch {
    return null;
  }
}

function summarise(post: SourcePost) {
  const rate = engagementRate(post.engagement);
  return {
    id: post.id,
    url: post.url,
    author: post.author,
    text: post.text,
    media: post.media,
    engagement: {
      ...post.engagement,
      engagementRatePct: rate != null ? Number((rate * 100).toFixed(3)) : null,
    },
    createdAt: post.createdAt,
    isLongForm: post.isLongForm,
    truncated: post.truncated,
    fetchedVia: post.source,
  };
}

async function buildResult(post: SourcePost): Promise<CallToolResult> {
  const photo = post.media.find((m) => m.type === "photo") ?? post.media[0];
  const creative = photo ? await loadCreative(photo.url) : null;

  const summary = summarise(post);
  const notes: string[] = [];

  if (post.truncated) {
    notes.push(
      "This source truncated the body. Analyse only what is present, or ask the operator to paste the full ad.",
    );
  }
  if (photo && !creative) {
    notes.push(
      "The creative could not be downloaded, so no image is attached. Treat this ad as copy-only rather than guessing at the visual.",
    );
  }
  if (creative) {
    notes.push(
      "The creative is attached as an image. Read it as an ad: what the composition DOES, not just what it shows.",
    );
  }

  const content: CallToolResult["content"] = [
    { type: "text", text: JSON.stringify({ ...summary, notes }, null, 2) },
  ];

  if (creative) {
    content.push({
      type: "image",
      data: creative.base64,
      mimeType: creative.mediaType,
    });
  }

  return { content, structuredContent: summary as unknown as Record<string, unknown> };
}

export function registerSourceTools(server: McpServer): void {
  server.registerTool(
    "fetch_ad",
    {
      title: "Fetch an ad to clone",
      description: [
        "Read a public ad and return its copy, engagement figures and creative.",
        "",
        "Pass `url` for an X/Twitter post — fetched free, in full, including long-form bodies.",
        "",
        "For LinkedIn, Meta and Google, pass `text` (and optionally `imageUrl`, which may be a data: URL) instead. Those ad libraries sit behind bot protection, so pasting is the route in, not a fallback — everything downstream is identical.",
        "",
        "When a creative exists it comes back as an image block for you to read directly.",
      ].join("\n"),
      inputSchema: {
        url: z.string().optional().describe("An x.com/twitter.com post URL."),
        text: z.string().optional().describe("Pasted ad copy, for any platform."),
        imageUrl: z
          .string()
          .optional()
          .describe("Creative URL or data: URL, used with `text`."),
        author: z.string().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ url, text, imageUrl, author }) => {
      if (text?.trim()) {
        return buildResult(manualPost({ text, imageUrl, author }));
      }

      if (!url?.trim()) {
        return fail(
          "Provide either `url` (an X post) or `text` (pasted copy for any platform).",
        );
      }

      const result = await fetchPost(url);
      if (!result.ok) {
        return fail(
          `${result.message}\n\nIf this is a LinkedIn, Meta or Google ad, those libraries block automated reads — ask the operator to paste the copy and call this again with \`text\`.`,
        );
      }

      return buildResult(result.post);
    },
  );

  server.registerTool(
    "fetch_ads",
    {
      title: "Fetch several ads at once",
      description: [
        "Fetch up to 20 X post URLs in one call, for working through a set.",
        "",
        "Returns copy and engagement only — no images, because twenty creatives would flood the context. Call fetch_ad on the individual ones whose visuals matter.",
        "",
        "A URL that cannot be read comes back with its reason and does not stop the others.",
      ].join("\n"),
      inputSchema: {
        urls: z.array(z.string()).min(1).max(20),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ urls }) => {
      const results = await Promise.all(
        urls.map(async (url) => {
          const result = await fetchPost(url);
          return result.ok
            ? { url, ok: true as const, ad: summarise(result.post) }
            : { url, ok: false as const, error: result.message };
        }),
      );

      return ok({
        fetched: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        results,
      });
    },
  );
}
