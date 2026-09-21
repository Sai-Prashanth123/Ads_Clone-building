import type { BrandProfile } from "./ai/schemas";

/**
 * The brand profile is per-viewer convenience, not application state — the
 * server never needs it except as request payload. It therefore lives in
 * localStorage and is read through `useSyncExternalStore`, which is the
 * correct primitive for external mutable state: hydration-safe by way of an
 * explicit server snapshot, and no setState-in-effect.
 */

export type BrandStoreValue = { brand: BrandProfile; enabled: boolean };

const KEY = "adclone.brand";
const EMPTY: BrandStoreValue = Object.freeze({ brand: {}, enabled: false });

const listeners = new Set<() => void>();

// getSnapshot must be referentially stable between reads or React loops
// forever, so the parsed value is cached against the raw string it came from.
let cachedRaw: string | null = null;
let cachedValue: BrandStoreValue = EMPTY;

function parse(raw: string | null): BrandStoreValue {
  if (!raw) return EMPTY;
  try {
    const parsed = JSON.parse(raw) as Partial<BrandStoreValue>;
    return {
      brand: parsed.brand ?? {},
      enabled: Boolean(parsed.enabled),
    };
  } catch {
    return EMPTY;
  }
}

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    // Private window, blocked site data, or a sandboxed frame.
    return null;
  }
}

export function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // Keep other tabs in step.
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function getSnapshot(): BrandStoreValue {
  const raw = read();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedValue = parse(raw);
  }
  return cachedValue;
}

/** The server has no localStorage; both renders must agree on this. */
export function getServerSnapshot(): BrandStoreValue {
  return EMPTY;
}

export function writeBrandStore(next: BrandStoreValue): void {
  const raw = JSON.stringify(next);
  cachedRaw = raw;
  cachedValue = next;
  try {
    localStorage.setItem(KEY, raw);
  } catch {
    // Storage unavailable — the value still holds for this session.
  }
  for (const listener of listeners) listener();
}
