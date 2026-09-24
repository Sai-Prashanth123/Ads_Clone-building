"use client";

import { Panel } from "./primitives";
import { ANGLE_LABELS, angles, type Angle } from "@/lib/ai/schemas";

/**
 * Placeholders for the three variations while they are being written.
 *
 * The writing step is the longest in the run, and doubles when the originality
 * guard forces a rewrite. Showing the three slots — labelled, in final
 * position — turns that wait from "did it hang?" into "two more to come".
 */

function Line({ width }: { width: string }) {
  return <span className="skeleton skeleton-line" style={{ width }} />;
}

export function VariationSkeleton({
  angle,
  stage,
}: {
  angle: Angle;
  stage: "writing" | "checking" | "rewriting";
}) {
  const meta = ANGLE_LABELS[angle];

  const note =
    stage === "rewriting"
      ? "Did not clear the guards — rewriting"
      : stage === "checking"
        ? "Scoring against the original"
        : "Writing";

  return (
    <Panel
      className="scanning"
      title={meta.label}
      right={
        <span
          className="chip"
          style={stage === "rewriting" ? { borderColor: "var(--caution)", color: "var(--caution)" } : undefined}
        >
          <span className="dot pulse" />
          {stage === "rewriting" ? "rewriting" : "working"}
        </span>
      }
      bodyClassName="p-3 flex flex-col gap-3"
    >
      <p className="t-label normal-case tracking-normal caret">{note}</p>

      <div className="sunken p-3">
        <Line width="92%" />
        <Line width="78%" />
        <Line width="85%" />
        <Line width="46%" />
        <Line width="88%" />
        <Line width="63%" />
      </div>

      <div>
        <div className="t-label mb-1.5">Originality vs source</div>
        <div className="meter" aria-hidden>
          {Array.from({ length: 20 }, (_, i) => (
            <span
              key={i}
              className="meter-seg meter-seg-working"
              style={{ animationDelay: `${i * 70}ms` }}
            />
          ))}
        </div>
      </div>

      <div className="pt-3 border-t border-[var(--rule)]">
        <div className="t-label mb-2">Creative</div>
        <Line width="70%" />
      </div>
    </Panel>
  );
}

export function VariationSkeletonRow({
  stage,
}: {
  stage: "writing" | "checking" | "rewriting";
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-3 items-start">
      {angles.map((angle) => (
        <VariationSkeleton key={angle} angle={angle} stage={stage} />
      ))}
    </div>
  );
}
