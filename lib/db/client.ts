import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The swipe file is optional. If Supabase isn't configured the studio still
 * works end to end — it just doesn't remember anything — so every call site
 * checks `isSwipeFileEnabled()` rather than assuming a client exists.
 *
 * Lazy, and deliberately not a Proxy: build-time evaluation of module scope
 * would otherwise crash `next build` before the env vars are set.
 */

let client: SupabaseClient | null = null;

function config(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  return url && key ? { url, key } : null;
}

export function isSwipeFileEnabled(): boolean {
  return config() !== null;
}

export function getDb(): SupabaseClient {
  if (client) return client;

  const conf = config();
  if (!conf) {
    throw new Error(
      "The swipe file is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local.",
    );
  }

  client = createClient(conf.url, conf.key, {
    auth: { persistSession: false },
  });
  return client;
}

export const CREATIVES_BUCKET = "creatives";
