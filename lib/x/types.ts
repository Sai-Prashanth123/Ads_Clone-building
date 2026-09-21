export type SourceMedia = {
  type: "photo" | "video";
  url: string;
  width?: number;
  height?: number;
};

export type Engagement = {
  likes?: number;
  replies?: number;
  retweets?: number;
  quotes?: number;
  bookmarks?: number;
  views?: number;
};

export type SourcePost = {
  id: string;
  url: string;
  author: { name: string; handle: string; avatar?: string };
  /** t.co noise stripped, entities expanded, long-form kept whole. */
  text: string;
  media: SourceMedia[];
  engagement: Engagement;
  createdAt?: string;
  /** True when X classifies this as a long-form (note) post. */
  isLongForm?: boolean;
  /** Set when the source could only give us a truncated body. */
  truncated?: boolean;
  /** Which adapter produced this, surfaced in the UI. */
  source: "fxtwitter" | "syndication" | "twitterapi" | "manual";
};

export type FetchFailure = {
  ok: false;
  reason: "bad-url" | "not-found" | "protected" | "network" | "no-adapter";
  message: string;
};

export type FetchResult = { ok: true; post: SourcePost } | FetchFailure;

/** Engagement rate-of-attention, used to sanity-check "is this actually a winner". */
export function engagementRate(e: Engagement): number | null {
  if (!e.views || e.views <= 0) return null;
  const actions = (e.likes ?? 0) + (e.retweets ?? 0) + (e.bookmarks ?? 0);
  return actions / e.views;
}
