/**
 * Pull a status id out of whatever the user pasted.
 *
 * Accepts x.com / twitter.com / mobile.twitter.com / vxtwitter / fxtwitter,
 * /status/ and the older /statuses/, trailing /photo/1 or /video/1,
 * query strings and trackers, or a bare numeric id.
 */
const HOSTS = new Set([
  "x.com",
  "www.x.com",
  "twitter.com",
  "www.twitter.com",
  "mobile.twitter.com",
  "mobile.x.com",
  "vxtwitter.com",
  "fxtwitter.com",
  "fixupx.com",
  "nitter.net",
]);

const STATUS_RE = /\/status(?:es)?\/(\d{5,25})/;

export function parseTweetUrl(
  input: string,
): { id: string; url: string } | null {
  const raw = input.trim();
  if (!raw) return null;

  // A bare id pasted on its own.
  if (/^\d{5,25}$/.test(raw)) {
    return { id: raw, url: `https://x.com/i/status/${raw}` };
  }

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    // Not a URL — last chance, look for a status id anywhere in the string.
    const loose = raw.match(STATUS_RE);
    return loose ? { id: loose[1], url: `https://x.com/i/status/${loose[1]}` } : null;
  }

  const host = parsed.hostname.toLowerCase();
  if (!HOSTS.has(host)) return null;

  const match = parsed.pathname.match(STATUS_RE);
  if (!match) return null;

  const id = match[1];
  // Rebuild canonically: drops /photo/1, ?s=20, utm tags and the like.
  const handle = parsed.pathname.split("/").filter(Boolean)[0] ?? "i";
  return { id, url: `https://x.com/${handle}/status/${id}` };
}
