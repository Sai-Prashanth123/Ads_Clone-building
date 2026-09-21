"use client";

import * as React from "react";
import Link from "next/link";
import { Chip, CopyButton, Meter, Panel, StatusBadge } from "@/components/primitives";
import { hookTypes } from "@/lib/ai/schemas";
import type { SavedSwipe } from "@/lib/db/swipes";

function compact(n?: number): string {
  if (n == null) return "—";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export default function LibraryPage() {
  const [swipes, setSwipes] = React.useState<SavedSwipe[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [hook, setHook] = React.useState<string>("");
  const [open, setOpen] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async (q: string, h: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (h) params.set("hook", h);

      const res = await fetch(`/api/swipes?${params}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not load the library.");
      setSwipes(body.swipes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the library.");
      setSwipes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Also performs the initial load: on mount this fires with the empty
  // filters, so a separate bootstrap effect would only duplicate the fetch.
  React.useEffect(() => {
    const t = setTimeout(() => void load(search, hook), 250);
    return () => clearTimeout(t);
  }, [search, hook, load]);

  async function remove(id: string) {
    const previous = swipes;
    setSwipes((s) => s?.filter((x) => x.id !== id) ?? null);
    const res = await fetch(`/api/swipes?id=${id}`, { method: "DELETE" });
    if (!res.ok) setSwipes(previous ?? null);
  }

  return (
    <main className="mx-auto w-full max-w-[1400px] px-4 py-6 flex flex-col gap-4">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="t-h1">Swipe file</h1>
          <p className="t-label normal-case tracking-normal mt-1 max-w-[62ch]">
            Every ad you&apos;ve deconstructed, with its framework and the clones
            it produced. Searchable as it grows.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Link href="/" className="btn btn-sm">
            Studio
          </Link>
          <StatusBadge
            state={error ? "failed" : loading ? "live" : "idle"}
            label={
              error
                ? "failed"
                : loading
                  ? "loading"
                  : `${swipes?.length ?? 0} saved`
            }
          />
        </div>
      </header>

      <Panel bodyClassName="p-3">
        <div className="flex gap-2 flex-wrap sm:flex-nowrap">
          <input
            className="input flex-1 min-w-[220px]"
            placeholder="Search copy, author…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            spellCheck={false}
            aria-label="Search the swipe file"
          />
        </div>
        <div className="flex items-center gap-1 mt-2 flex-wrap">
          <span className="t-label mr-1">Hook:</span>
          <button
            type="button"
            className={`chip cursor-pointer ${hook === "" ? "chip-solid" : ""}`}
            onClick={() => setHook("")}
          >
            all
          </button>
          {hookTypes.map((h) => (
            <button
              key={h}
              type="button"
              className={`chip cursor-pointer ${hook === h ? "chip-solid" : ""}`}
              onClick={() => setHook(hook === h ? "" : h)}
            >
              {h.replace(/-/g, " ")}
            </button>
          ))}
        </div>
      </Panel>

      {error && (
        <Panel bodyClassName="p-3">
          <div className="flex items-start gap-2">
            <span className="chip chip-alert shrink-0">error</span>
            <p className="text-[12px] leading-[1.5]" style={{ color: "var(--alert)" }}>
              {error}
            </p>
          </div>
        </Panel>
      )}

      {!error && swipes?.length === 0 && !loading && (
        <Panel bodyClassName="p-6">
          <p className="t-label normal-case tracking-normal text-center">
            Nothing saved yet. Clone an ad in the{" "}
            <Link href="/" className="underline underline-offset-2">
              studio
            </Link>{" "}
            and hit Save run.
          </p>
        </Panel>
      )}

      <div className="flex flex-col gap-3">
        {swipes?.map((swipe) => {
          const isOpen = open === swipe.id;
          return (
            <Panel
              key={swipe.id}
              hover
              title={`@${swipe.author_handle ?? "unknown"}`}
              right={
                <div className="flex items-center gap-1.5">
                  {swipe.hook_type && (
                    <Chip tone="brand">{swipe.hook_type.replace(/-/g, " ")}</Chip>
                  )}
                  <Chip>{swipe.clones?.length ?? 0} clones</Chip>
                  <span className="t-label tabular-nums">
                    {new Date(swipe.created_at).toLocaleDateString("en-GB", {
                      day: "2-digit",
                      month: "short",
                    })}
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setOpen(isOpen ? null : swipe.id)}
                    aria-expanded={isOpen}
                  >
                    {isOpen ? "Collapse" : "Open"}
                  </button>
                </div>
              }
              bodyClassName="p-3"
            >
              <div className="flex gap-3">
                {swipe.original_media_url && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={swipe.original_media_url}
                    alt=""
                    className="w-20 h-20 object-cover border border-[var(--rule)] shrink-0"
                  />
                )}
                <p className="text-[12px] leading-[1.5] text-[var(--ink-2)] line-clamp-3">
                  {swipe.original_text.slice(0, 260)}
                  {swipe.original_text.length > 260 ? "…" : ""}
                </p>
              </div>

              <div className="flex items-center gap-3 mt-2 flex-wrap">
                <span className="t-label tabular-nums">
                  {compact(swipe.engagement?.likes)} likes
                </span>
                <span className="t-label tabular-nums">
                  {compact(swipe.engagement?.views)} views
                </span>
                {swipe.source_url && (
                  <a
                    href={swipe.source_url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="t-label underline underline-offset-2"
                  >
                    Source
                  </a>
                )}
                <button
                  type="button"
                  className="btn btn-sm btn-danger ml-auto"
                  onClick={() => void remove(swipe.id)}
                >
                  Delete
                </button>
              </div>

              {isOpen && (
                <div className="mt-3 pt-3 border-t border-[var(--rule)] grid gap-3 lg:grid-cols-3">
                  {swipe.clones?.map((clone) => (
                    <div key={clone.id} className="sunken p-2.5">
                      <div className="flex items-center justify-between mb-2">
                        <span className="t-label">
                          {clone.angle.replace(/-/g, " ")}
                        </span>
                        {typeof clone.originality?.score === "number" && (
                          <Chip
                            tone={clone.originality.pass ? "brand" : "alert"}
                          >
                            {clone.originality.score}/100
                          </Chip>
                        )}
                      </div>

                      {typeof clone.originality?.score === "number" && (
                        <div className="mb-2">
                          <Meter
                            value={clone.originality.score}
                            tone={clone.originality.pass ? "brand" : "alert"}
                          />
                        </div>
                      )}

                      {clone.image_url && (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={clone.image_url}
                          alt={clone.alt_text ?? ""}
                          className="w-full block mb-2 border border-[var(--rule)]"
                        />
                      )}

                      <pre className="whitespace-pre-wrap break-words font-[inherit] text-[12px] leading-[1.5] max-h-[220px] overflow-y-auto scroll-thin">
                        {clone.body}
                      </pre>

                      <div className="mt-2">
                        <CopyButton text={clone.body} label="Copy" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          );
        })}
      </div>
    </main>
  );
}
