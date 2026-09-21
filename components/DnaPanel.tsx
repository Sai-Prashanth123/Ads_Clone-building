"use client";

import { Chip, Panel } from "./primitives";
import type { AdDna } from "@/lib/ai/schemas";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[92px_minmax(0,1fr)] gap-3 py-1.5">
      <div className="t-label pt-0.5">{label}</div>
      <div className="text-[12px] text-[var(--ink-2)] leading-[1.5]">{children}</div>
    </div>
  );
}

/** A colour name or hex from the model, rendered as a swatch when parseable. */
function Swatch({ value }: { value: string }) {
  const hex = value.match(/#[0-9a-f]{3,8}/i)?.[0];
  const named = value.trim().toLowerCase().replace(/[^a-z\s-]/g, "");
  const colour = hex ?? (named.split(/\s+/).length <= 2 ? named : undefined);

  return (
    <span className="inline-flex items-center gap-1.5 border border-[var(--rule-strong)] pr-2 h-5">
      <span
        aria-hidden
        className="w-4 h-full block"
        style={{
          background: colour || "transparent",
          borderRight: "1px solid var(--rule)",
        }}
      />
      <span className="text-[10px] tracking-[0.04em] uppercase">{value}</span>
    </span>
  );
}

export function DnaPanel({ dna }: { dna: AdDna }) {
  return (
    <Panel
      title="Ad DNA"
      right={<Chip tone="brand">{dna.hook.type.replace(/-/g, " ")}</Chip>}
      bodyClassName="p-3"
    >
      {/* Beat timeline — the skeleton every variation must preserve. */}
      <div className="t-label mb-2">Structure</div>
      <ol className="flex flex-wrap gap-1 mb-3">
        {dna.structure.beats.map((beat, i) => (
          <li key={i} className="group relative">
            <span
              className="chip"
              title={`${beat.purpose} · ${beat.lineCount} line${beat.lineCount === 1 ? "" : "s"}`}
            >
              <span className="tabular-nums opacity-50">
                {String(i + 1).padStart(2, "0")}
              </span>
              {beat.role}
            </span>
          </li>
        ))}
      </ol>

      <div className="sunken p-2.5 mb-3">
        <div className="t-label mb-1">Hook · why it stops</div>
        <p className="text-[12px] text-[var(--ink)] leading-[1.5]">
          {dna.hook.whyItStops}
        </p>
        <p className="text-[11px] text-[var(--muted)] mt-1.5 italic break-words">
          “{dna.hook.verbatimOpening}”
        </p>
      </div>

      <div className="divide-y divide-[var(--rule)]">
        <Row label="Audience">
          {dna.audience.who}
          <span className="text-[var(--muted)]">
            {" "}
            · {dna.audience.sophisticationLevel.replace(/-/g, " ")}
          </span>
        </Row>
        <Row label="Pain state">{dna.audience.painState}</Row>
        <Row label="Triggers">
          <span className="flex flex-wrap gap-1">
            {dna.persuasion.triggers.map((t) => (
              <Chip key={t}>{t}</Chip>
            ))}
          </span>
        </Row>
        <Row label="Proof">{dna.persuasion.proofType}</Row>
        <Row label="CTA">
          {dna.cta.style}
          <span className="text-[var(--muted)]"> · “{dna.cta.verbatim}”</span>
        </Row>
        <Row label="Formatting">
          {dna.formatting.lineBreakPattern}; {dna.formatting.emojiUse};{" "}
          {dna.formatting.listStyle}
          <span className="text-[var(--muted)]">
            {" "}
            · {dna.formatting.approxLength} chars
          </span>
        </Row>
      </div>

      {dna.visual && (
        <div className="mt-3 pt-3 border-t border-[var(--rule)]">
          <div className="t-label mb-2">Visual DNA</div>
          <div className="flex flex-wrap gap-1 mb-2">
            {dna.visual.palette.map((c) => (
              <Swatch key={c} value={c} />
            ))}
          </div>
          <div className="divide-y divide-[var(--rule)]">
            <Row label="Layout">{dna.visual.layout}</Row>
            <Row label="Subject">{dna.visual.subject}</Row>
            <Row label="Style">{dna.visual.style}</Row>
            <Row label="Overlay">{dna.visual.textOverlay}</Row>
            <Row label="Its job">{dna.visual.roleInAd}</Row>
          </div>
        </div>
      )}

      <div className="mt-3 pt-3 border-t border-[var(--rule)]">
        <div className="t-label mb-1.5">Why it works</div>
        <ul className="space-y-1.5">
          {dna.whyItWorks.map((w, i) => (
            <li
              key={i}
              className="text-[12px] text-[var(--ink-2)] leading-[1.5] pl-4 relative"
            >
              <span
                aria-hidden
                className="absolute left-0 top-[6px] w-2 h-px"
                style={{ background: "var(--brand-deep)" }}
              />
              {w}
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}
