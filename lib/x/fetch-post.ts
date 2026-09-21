import { parseTweetUrl } from "./parse-url";
import { fetchViaFxTwitter } from "./adapters/fxtwitter";
import { fetchViaSyndication } from "./adapters/syndication";
import { fetchViaTwitterApi } from "./adapters/twitterapi";
import type { FetchResult, SourcePost } from "./types";

const TIMEOUT_MS = 12_000;

type Adapter = (
  id: string,
  url: string,
  signal?: AbortSignal,
) => Promise<SourcePost | null>;

/**
 * First success wins. Each adapter returns null rather than throwing.
 *
 * fxtwitter leads because it is the only free source that returns long-form
 * posts whole plus view counts; syndication backs it up if FixTweet is down.
 */
const CHAIN: { name: string; run: Adapter }[] = [
  { name: "fxtwitter", run: fetchViaFxTwitter },
  { name: "syndication", run: fetchViaSyndication },
  { name: "twitterapi", run: fetchViaTwitterApi },
];

export async function fetchPost(input: string): Promise<FetchResult> {
  const parsed = parseTweetUrl(input);
  if (!parsed) {
    return {
      ok: false,
      reason: "bad-url",
      message:
        "That doesn't look like an X post link. Paste something like https://x.com/handle/status/123…",
    };
  }

  let networkTrouble = false;

  for (const adapter of CHAIN) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const post = await adapter.run(parsed.id, parsed.url, controller.signal);
      if (post) return { ok: true, post };
    } catch {
      // A failing adapter is expected traffic, not an error condition —
      // note it and let the next one try.
      networkTrouble = true;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    ok: false,
    reason: networkTrouble ? "network" : "not-found",
    message: networkTrouble
      ? "Couldn't reach X to read that post. Check the link, or paste the post manually below."
      : "That post couldn't be read — it may be protected, deleted, or age-restricted. Paste it manually below and the studio works exactly the same.",
  };
}

/**
 * The guaranteed floor. If every fetch fails, the user pastes the post and the
 * rest of the pipeline is identical — the studio is never dead on a link.
 */
export function manualPost(args: {
  text: string;
  imageUrl?: string;
  author?: string;
}): SourcePost {
  return {
    id: `manual-${Date.now()}`,
    url: "",
    author: { name: args.author || "Pasted post", handle: args.author || "manual" },
    text: args.text.trim(),
    media: args.imageUrl ? [{ type: "photo" as const, url: args.imageUrl }] : [],
    engagement: {},
    source: "manual",
  };
}
