"use client";

import * as React from "react";
import Link from "next/link";
import { Chip, Field, Meter, Panel, StatusBadge } from "@/components/primitives";
import { PLATFORM_IDS, PLATFORMS } from "@/lib/platforms";
import type { BatchItem, ItemStatus } from "@/lib/batch/types";

type BatchRow = {
  id: string;
  created_at: string;
  label: string | null;
  target_platform: string;
  status: string;
  total: number;
  done: number;
  failed: number;
};

type Progress = {
  batch: BatchRow;
  items: BatchItem[];
  totals: Record<ItemStatus, number>;
  running: boolean;
};

const STATUS_TONE: Record<string, "brand" | "alert" | "caution" | "plain"> = {
  done: "brand",
  failed: "alert",
  running: "caution",
  queued: "plain",
  skipped: "plain",
};

export default function BatchesPage() {
  const [batches, setBatches] = React.useState<BatchRow[] | null>(null);
  const [open, setOpen] = React.useState<string | null>(null);
  const [progress, setProgress] = React.useState<Progress | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);

  const [urls, setUrls] = React.useState("");
  const [label, setLabel] = React.useState("");
  const [platform, setPlatform] = React.useState("x");

  const loadBatches = React.useCallback(async () => {
    try {
      const res = await fetch("/api/batch");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not load batches.");
      setBatches(body.batches);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load batches.");
      setBatches([]);
    }
  }, []);

  React.useEffect(() => {
    const t = setTimeout(() => void loadBatches(), 0);
    return () => clearTimeout(t);
  }, [loadBatches]);

  // Poll the open batch while it still has work in flight. Stops on its own
  // once nothing is queued or running, so an idle tab makes no requests.
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function tick() {
      try {
        const res = await fetch(`/api/batch/${open}`);
        const body = await res.json();
        if (cancelled || !res.ok) return;
        setProgress(body);
      } catch {
        /* a dropped poll is not worth surfacing */
      }
    }

    void tick();
    const id = setInterval(() => {
      const busy =
        !progress ||
        progress.totals.queued > 0 ||
        progress.totals.running > 0;
      if (busy) void tick();
    }, 2500);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [open, progress]);

  async function create() {
    const sources = urls
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((url) => ({ url }));

    if (sources.length === 0) return;

    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: label.trim() || undefined,
          targetPlatform: platform,
          sources,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not start the batch.");
      setUrls("");
      setLabel("");
      setOpen(body.id);
      await loadBatches();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the batch.");
    } finally {
      setCreating(false);
    }
  }

  async function retryFailed(id: string) {
    await fetch(`/api/batch/${id}?action=retry-failed`, { method: "POST" });
  }

  const pending = urls.split("\n").filter((l) => l.trim()).length;

  return (
    <main className="mx-auto w-full max-w-[1400px] px-4 py-6 flex flex-col gap-4">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="t-h1">Batches</h1>
          <p className="t-label normal-case tracking-normal mt-1 max-w-[62ch]">
            Queue many ads at once. Work continues after you close the tab —
            progress lives in the database, not the page.
          </p>
        </div>
        <StatusBadge
          state={progress?.running ? "live" : "idle"}
          label={progress?.running ? "processing" : `${batches?.length ?? 0} runs`}
        />
      </header>

      <Panel title="New batch" bodyClassName="p-3">
        <div className="grid gap-2.5 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Field label="Ad URLs" hint="One per line. Up to 100.">
            <textarea
              className="input"
              rows={6}
              placeholder={"https://x.com/handle/status/123…\nhttps://x.com/handle/status/456…"}
              value={urls}
              onChange={(e) => setUrls(e.target.value)}
              spellCheck={false}
            />
          </Field>
          <div className="flex flex-col gap-2.5">
            <Field label="Label" hint="Optional, for finding it later.">
              <input
                className="input"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Competitor sweep, March"
              />
            </Field>
            <div>
              <span className="t-label block mb-1">Write for</span>
              <div className="flex flex-wrap gap-1">
                {PLATFORM_IDS.map((id) => (
                  <button
                    key={id}
                    type="button"
                    className={`chip cursor-pointer ${platform === id ? "chip-solid" : ""}`}
                    onClick={() => setPlatform(id)}
                    title={PLATFORMS[id].note}
                  >
                    {PLATFORMS[id].label}
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              className="btn btn-primary mt-auto"
              onClick={() => void create()}
              disabled={creating || pending === 0}
            >
              {creating ? "Queueing…" : `Queue ${pending || ""} ${pending === 1 ? "ad" : "ads"}`.trim()}
            </button>
          </div>
        </div>

        {pending > 12 && (
          <p className="t-label normal-case tracking-normal mt-2" style={{ color: "var(--caution)" }}>
            Free-tier model quota paces this at roughly 15 clones a minute, so
            {` ${pending}`} will take around {Math.ceil(pending / 15)} minutes. Keep this
            tab open on Render&apos;s free plan — the service sleeps when idle.
          </p>
        )}
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

      {batches?.length === 0 && !error && (
        <Panel bodyClassName="p-6">
          <p className="t-label normal-case tracking-normal text-center">
            No batches yet. Paste some URLs above, or clone one ad in the{" "}
            <Link href="/" className="underline underline-offset-2">studio</Link>.
          </p>
        </Panel>
      )}

      <div className="flex flex-col gap-3">
        {batches?.map((b) => {
          const isOpen = open === b.id;
          const pct = b.total ? Math.round((b.done / b.total) * 100) : 0;

          return (
            <Panel
              key={b.id}
              hover
              title={b.label || `Batch ${b.id.slice(0, 8)}`}
              right={
                <div className="flex items-center gap-1.5">
                  <Chip>{PLATFORMS[b.target_platform as "x"]?.label ?? b.target_platform}</Chip>
                  <Chip tone={STATUS_TONE[b.status] ?? "plain"}>{b.status}</Chip>
                  <span className="t-label tabular-nums">
                    {b.done}/{b.total}
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setOpen(isOpen ? null : b.id)}
                    aria-expanded={isOpen}
                  >
                    {isOpen ? "Collapse" : "Open"}
                  </button>
                </div>
              }
              bodyClassName="p-3"
            >
              <Meter value={pct} tone={b.failed > 0 ? "caution" : "brand"} />
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                <span className="t-label tabular-nums">{pct}% complete</span>
                {b.failed > 0 && (
                  <>
                    <span className="t-label tabular-nums" style={{ color: "var(--alert)" }}>
                      {b.failed} failed
                    </span>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => void retryFailed(b.id)}
                    >
                      Retry failed
                    </button>
                  </>
                )}
                <span className="t-label ml-auto">
                  {new Date(b.created_at).toLocaleString("en-GB", {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>

              {isOpen && progress?.batch.id === b.id && (
                <ol className="mt-3 pt-3 border-t border-[var(--rule)] divide-y divide-[var(--rule)]">
                  {progress.items.map((item) => (
                    <li
                      key={item.id}
                      className="grid grid-cols-[22px_minmax(0,1fr)_auto] gap-2 py-1.5 items-center"
                    >
                      <span className="t-label tabular-nums">
                        {String(item.position + 1).padStart(2, "0")}
                      </span>
                      <span className="text-[11px] text-[var(--ink-2)] truncate">
                        {item.source_url ?? item.source_text?.slice(0, 80) ?? "—"}
                        {item.error && (
                          <span style={{ color: "var(--alert)" }}> · {item.error}</span>
                        )}
                      </span>
                      <span
                        className={`chip ${
                          item.status === "done"
                            ? "chip-brand"
                            : item.status === "failed"
                              ? "chip-alert"
                              : item.status === "running"
                                ? "chip-solid"
                                : ""
                        }`}
                      >
                        {item.status === "running" && <span className="dot pulse" />}
                        {item.status}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </Panel>
          );
        })}
      </div>
    </main>
  );
}
