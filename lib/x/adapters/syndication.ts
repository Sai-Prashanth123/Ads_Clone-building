import type { SourceMedia, SourcePost } from "../types";

/**
 * X's public syndication endpoint — the one the embed widget uses.
 * No API key, no OAuth, no rate-limit headers to manage.
 *
 * The `token` is not a secret; it's a checksum derived from the id that the
 * endpoint requires. Verified working against live posts (both media and
 * text-only) during design.
 *
 * Limits, by design of the endpoint: no view/retweet/bookmark counts, nothing
 * for protected/deleted/age-restricted posts, and video posts return only a
 * poster frame. The adapter chain handles those cases.
 */
const ENDPOINT = "https://cdn.syndication.twimg.com/tweet-result";

export function syndicationToken(id: string): string {
  return ((Number(id) / 1e15) * Math.PI)
    .toString(36)
    .replace(/(0+|\.)/g, "");
}

type SyndicationUser = {
  name?: string;
  screen_name?: string;
  profile_image_url_https?: string;
};

type SyndicationMedia = {
  type?: string;
  media_url_https?: string;
  url?: string;
  original_info?: { width?: number; height?: number };
};

type SyndicationPhoto = {
  url?: string;
  width?: number;
  height?: number;
};

type SyndicationResponse = {
  __typename?: string;
  text?: string;
  full_text?: string;
  created_at?: string;
  favorite_count?: number;
  conversation_count?: number;
  user?: SyndicationUser;
  photos?: SyndicationPhoto[];
  mediaDetails?: SyndicationMedia[];
  entities?: { urls?: { url?: string; expanded_url?: string; display_url?: string }[] };
  note_tweet?: { id?: string };
  display_text_range?: number[];
  tombstone?: unknown;
};

/** Expand t.co links and drop the trailing media shortlink X appends. */
function cleanText(raw: string, data: SyndicationResponse): string {
  let text = raw;

  for (const u of data.entities?.urls ?? []) {
    if (u.url && u.expanded_url) {
      text = text.split(u.url).join(u.expanded_url);
    }
  }

  // The media permalink at the end carries no meaning for copy analysis.
  text = text.replace(/\s*https:\/\/t\.co\/\w+\s*$/g, "");
  return text.trim();
}

export async function fetchViaSyndication(
  id: string,
  url: string,
  signal?: AbortSignal,
): Promise<SourcePost | null> {
  const qs = new URLSearchParams({
    id,
    lang: "en",
    token: syndicationToken(id),
  });

  const res = await fetch(`${ENDPOINT}?${qs}`, {
    signal,
    headers: {
      // The endpoint is picky about a bare/absent UA.
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!res.ok) return null;

  const data = (await res.json()) as SyndicationResponse;
  if (!data || data.tombstone || data.__typename === "TweetTombstone") return null;

  const text = data.text ?? data.full_text;
  if (typeof text !== "string") return null;

  const media: SourceMedia[] = [];

  for (const p of data.photos ?? []) {
    if (p.url) {
      media.push({ type: "photo", url: p.url, width: p.width, height: p.height });
    }
  }

  // mediaDetails carries video poster frames that `photos` omits.
  for (const m of data.mediaDetails ?? []) {
    const src = m.media_url_https ?? m.url;
    if (!src || media.some((existing) => existing.url === src)) continue;
    media.push({
      type: m.type === "photo" ? "photo" : "video",
      url: src,
      width: m.original_info?.width,
      height: m.original_info?.height,
    });
  }

  // Syndication truncates long-form posts at ~276 chars and exposes only an
  // opaque note_tweet id, never the full body. Flag it so the UI can say so.
  const truncated =
    data.note_tweet != null ||
    (Array.isArray(data.display_text_range) &&
      typeof data.display_text_range[1] === "number" &&
      data.display_text_range[1] >= 270);

  return {
    id,
    url,
    author: {
      name: data.user?.name ?? "Unknown",
      handle: data.user?.screen_name ?? "unknown",
      avatar: data.user?.profile_image_url_https,
    },
    text: cleanText(text, data),
    media,
    engagement: {
      likes: data.favorite_count,
      replies: data.conversation_count,
    },
    createdAt: data.created_at,
    truncated,
    source: "syndication",
  };
}
