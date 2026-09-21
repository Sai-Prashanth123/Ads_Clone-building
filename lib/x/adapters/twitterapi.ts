import type { SourceMedia, SourcePost } from "../types";

/**
 * Optional paid fallback for posts the public syndication endpoint won't serve.
 * Entirely inert unless TWITTERAPI_IO_KEY is set — the app is fully functional
 * without it.
 */
export async function fetchViaTwitterApi(
  id: string,
  url: string,
  signal?: AbortSignal,
): Promise<SourcePost | null> {
  const key = process.env.TWITTERAPI_IO_KEY;
  if (!key) return null;

  const res = await fetch(
    `https://api.twitterapi.io/twitter/tweets?tweet_ids=${id}`,
    { signal, headers: { "X-API-Key": key }, cache: "no-store" },
  );

  if (!res.ok) return null;

  const body = (await res.json()) as {
    tweets?: {
      text?: string;
      createdAt?: string;
      likeCount?: number;
      replyCount?: number;
      author?: {
        name?: string;
        userName?: string;
        profilePicture?: string;
      };
      extendedEntities?: {
        media?: { type?: string; media_url_https?: string }[];
      };
    }[];
  };

  const tweet = body.tweets?.[0];
  if (!tweet?.text) return null;

  const media: SourceMedia[] = (tweet.extendedEntities?.media ?? [])
    .filter((m) => m.media_url_https)
    .map((m) => ({
      type: m.type === "photo" ? ("photo" as const) : ("video" as const),
      url: m.media_url_https as string,
    }));

  return {
    id,
    url,
    author: {
      name: tweet.author?.name ?? "Unknown",
      handle: tweet.author?.userName ?? "unknown",
      avatar: tweet.author?.profilePicture,
    },
    text: tweet.text.replace(/\s*https:\/\/t\.co\/\w+\s*$/g, "").trim(),
    media,
    engagement: { likes: tweet.likeCount, replies: tweet.replyCount },
    createdAt: tweet.createdAt,
    source: "twitterapi",
  };
}
