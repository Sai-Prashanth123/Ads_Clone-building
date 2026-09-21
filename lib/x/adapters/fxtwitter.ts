import type { SourceMedia, SourcePost } from "../types";

/**
 * Primary adapter. FixTweet's public API — free, keyless, and the only source
 * tested here that returns long-form posts *whole*. The syndication endpoint
 * truncates them at ~276 characters, which would silently gut the analysis for
 * exactly the listicle-style ads worth cloning.
 *
 * It also carries view counts and bookmarks (syndication has neither) and
 * serves media at `?name=orig` full resolution, which matters for the vision
 * pass.
 */
const ENDPOINT = "https://api.fxtwitter.com/status";

type FxMedia = {
  type?: string;
  url?: string;
  width?: number;
  height?: number;
  thumbnail_url?: string;
};

type FxTweet = {
  text?: string;
  raw_text?: { text?: string };
  created_at?: string;
  likes?: number;
  replies?: number;
  retweets?: number;
  quotes?: number;
  bookmarks?: number;
  views?: number;
  is_note_tweet?: boolean;
  lang?: string;
  author?: {
    name?: string;
    screen_name?: string;
    avatar_url?: string;
  };
  media?: {
    photos?: FxMedia[];
    videos?: FxMedia[];
    all?: FxMedia[];
  };
};

export async function fetchViaFxTwitter(
  id: string,
  url: string,
  signal?: AbortSignal,
): Promise<SourcePost | null> {
  const res = await fetch(`${ENDPOINT}/${id}`, {
    signal,
    headers: {
      "User-Agent": "AdCloneStudio/1.0 (+ad framework analysis)",
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!res.ok) return null;

  const body = (await res.json()) as { code?: number; tweet?: FxTweet };
  const tweet = body.tweet;
  if (!tweet) return null;

  const text = tweet.raw_text?.text ?? tweet.text;
  if (typeof text !== "string" || !text.trim()) return null;

  const media: SourceMedia[] = [];
  for (const p of tweet.media?.photos ?? []) {
    if (p.url) {
      media.push({ type: "photo", url: p.url, width: p.width, height: p.height });
    }
  }
  for (const v of tweet.media?.videos ?? []) {
    // Poster frame — the vision pass reads a still, not the video.
    const poster = v.thumbnail_url;
    if (poster) {
      media.push({ type: "video", url: poster, width: v.width, height: v.height });
    }
  }

  return {
    id,
    url,
    author: {
      name: tweet.author?.name ?? "Unknown",
      handle: tweet.author?.screen_name ?? "unknown",
      avatar: tweet.author?.avatar_url,
    },
    text: text.replace(/\s*https:\/\/t\.co\/\w+\s*$/g, "").trim(),
    media,
    engagement: {
      likes: tweet.likes,
      replies: tweet.replies,
      retweets: tweet.retweets,
      quotes: tweet.quotes,
      bookmarks: tweet.bookmarks,
      views: tweet.views,
    },
    createdAt: tweet.created_at,
    isLongForm: tweet.is_note_tweet,
    source: "fxtwitter",
  };
}
