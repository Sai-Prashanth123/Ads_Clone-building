"use client";

import * as React from "react";
import Link from "next/link";
import { Cell, Lattice, Meter, Panel, StatusBadge } from "@/components/primitives";
import type { Playbook } from "@/lib/analysis/playbook";

function Bars({
  rows,
  emptyLabel,
}: {
  rows: { key: string; count: number; share: number; avgEngagement: number | null }[];
  emptyLabel: string;
}) {
  if (rows.length === 0) {
    return <p className="t-label normal-case tracking-normal">{emptyLabel}</p>;
  }

  const top = rows[0].count || 1;

  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => (
        <li key={row.key}>
          <div className="flex items-baseline justify-between gap-2 mb-1">
            <span className="text-[12px] text-[var(--ink)] truncate">
              {row.key.replace(/-/g, " ")}
            </span>
            <span className="t-label tabular-nums shrink-0">
              {row.count}
              {row.avgEngagement != null && (
                <span className="ml-2" style={{ color: "var(--brand-deep)" }}>
                  {(row.avgEngagement * 100).toFixed(2)}%
                </span>
              )}
            </span>
          </div>
          <Meter value={Math.round((row.count / top) * 100)} segments={24} />
        </li>
      ))}
    </ul>
  );
}

export default function PlaybookPage() {
  const [data, setData] = React.useState<Playbook | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/playbook");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not build the playbook.");
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not build the playbook.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <main className="mx-auto w-full max-w-[1400px] px-4 py-6 flex flex-col gap-4">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="t-h1">Playbook</h1>
          <p className="t-label normal-case tracking-normal mt-1 max-w-[62ch]">
            What the ads you keep have in common. Counted from the saved DNA, not
            summarised by a model — so it can be recomputed and checked.
          </p>
        </div>
        <StatusBadge
          state={error ? "failed" : loading ? "live" : "idle"}
          label={
            error ? "failed" : loading ? "counting" : `${data?.sampleSize ?? 0} ads`
          }
        />
      </header>

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

      {data && data.sampleSize === 0 && (
        <Panel bodyClassName="p-6">
          <p className="t-label normal-case tracking-normal text-center">
            Nothing saved yet. Clone some ads in the{" "}
            <Link href="/" className="underline underline-offset-2">studio</Link> and
            save the runs — patterns appear from about eight.
          </p>
        </Panel>
      )}

      {data && data.sampleSize > 0 && (
        <>
          <Panel title="What this says" bodyClassName="p-3">
            <ul className="space-y-2">
              {data.findings.map((f, i) => (
                <li
                  key={i}
                  className="text-[13px] leading-[1.5] text-[var(--ink)] pl-4 relative"
                >
                  <span
                    aria-hidden
                    className="absolute left-0 top-[9px] w-2 h-px"
                    style={{ background: "var(--brand-deep)" }}
                  />
                  {f}
                </li>
              ))}
            </ul>
          </Panel>

          <Lattice cols={4} className="border-b-0 border-r-0">
            <Cell label="Ads saved" value={data.sampleSize} />
            <Cell
              label="With view data"
              value={data.measured}
              sub="engagement rates come from these"
            />
            <Cell label="With creative" value={data.formats.withImage} />
            <Cell label="Copy only" value={data.formats.textOnly} />
          </Lattice>

          <div className="grid gap-4 lg:grid-cols-2 items-start">
            <Panel title="Hook types" bodyClassName="p-3">
              <p className="t-label normal-case tracking-normal mb-3">
                Count, and mean engagement rate where views are known.
              </p>
              <Bars rows={data.hooks} emptyLabel="No hooks recorded yet." />
            </Panel>

            <Panel title="Persuasion triggers" bodyClassName="p-3">
              <Bars rows={data.triggers} emptyLabel="No triggers recorded yet." />
            </Panel>

            <Panel title="Beat structures" bodyClassName="p-3">
              <Bars rows={data.structures} emptyLabel="No structures recorded yet." />
            </Panel>

            <Panel title="Proof used" bodyClassName="p-3">
              <Bars rows={data.proofTypes} emptyLabel="No proof types recorded yet." />
            </Panel>
          </div>

          {data.topPerformers.length > 0 && (
            <Panel title="Highest engagement in your file" bodyClassName="p-3">
              <ol className="divide-y divide-[var(--rule)]">
                {data.topPerformers.map((p) => (
                  <li key={p.id} className="py-2 flex items-baseline gap-3">
                    <span className="t-label tabular-nums shrink-0" style={{ color: "var(--brand-deep)" }}>
                      {((p.engagementRate ?? 0) * 100).toFixed(2)}%
                    </span>
                    <span className="text-[12px] text-[var(--ink-2)] truncate flex-1">
                      {p.excerpt}
                    </span>
                    <span className="t-label shrink-0">
                      {p.hook?.replace(/-/g, " ") ?? "—"}
                    </span>
                  </li>
                ))}
              </ol>
            </Panel>
          )}
        </>
      )}
    </main>
  );
}
