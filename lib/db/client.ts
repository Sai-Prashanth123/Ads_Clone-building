import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The swipe file is optional. If Supabase isn't configured the studio still
 * works end to end — it just doesn't remember anything — so every call site
 * checks `isSwipeFileEnabled()` rather than assuming a client exists.
 *
 * These env vars are deliberately NOT prefixed NEXT_PUBLIC_. That prefix
 * inlines a value into the browser bundle, and a database key in the bundle is
 * a database key in everyone's hands. Every query runs server-side in
 * app/api/swipes, so the client never needs credentials at all.
 *
 * Lazy, and deliberately not a Proxy: build-time evaluation of module scope
 * would otherwise crash `next build` before the env vars are set.
 */

let client: SupabaseClient | null = null;

type Config = { url: string; key: string; privileged: boolean };

function config(): Config | null {
  const url = process.env.SUPABASE_URL?.trim();
  if (!url) return null;

  // A secret key bypasses RLS, which lets the policies deny anon outright.
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  if (secret) return { url, key: secret, privileged: true };

  // Fallback: a publishable key still works, but only because the RLS policies
  // grant the anon role access. Server-side-only keeps it out of the bundle;
  // it does not make the policies safe on its own.
  const publishable = process.env.SUPABASE_PUBLISHABLE_KEY?.trim();
  if (publishable) return { url, key: publishable, privileged: false };

  return null;
}

export function isSwipeFileEnabled(): boolean {
  return config() !== null;
}

/** True when running with a key that bypasses RLS. */
export function isPrivileged(): boolean {
  return config()?.privileged ?? false;
}

export const SWIPE_FILE_SETUP_HINT =
  "The swipe file is not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local (server-side only — never prefix these NEXT_PUBLIC_).";

export function getDb(): SupabaseClient {
  if (client) return client;

  const conf = config();
  if (!conf) throw new Error(SWIPE_FILE_SETUP_HINT);

  client = createClient(conf.url, conf.key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

export const CREATIVES_BUCKET = "creatives";
