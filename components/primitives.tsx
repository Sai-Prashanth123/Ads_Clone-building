"use client";

import * as React from "react";

/* ------------------------------------------------------------------ *
 * Panel — the box the console is built from.
 * ------------------------------------------------------------------ */

export function Panel({
  title,
  right,
  children,
  className = "",
  hover = false,
  bodyClassName = "",
}: {
  title?: React.ReactNode;
  right?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  hover?: boolean;
  bodyClassName?: string;
}) {
  return (
    <section className={`panel ${hover ? "panel-hover" : ""} ${className}`}>
      {title !== undefined && (
        <header className="panel-header">
          <h2 className="panel-title">{title}</h2>
          {right}
        </header>
      )}
      {children !== undefined && (
        <div className={bodyClassName || "p-3"}>{children}</div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Chips & status
 * ------------------------------------------------------------------ */

type ChipTone = "plain" | "brand" | "solid" | "alert" | "caution";

export function Chip({
  tone = "plain",
  children,
  title,
}: {
  tone?: ChipTone;
  children: React.ReactNode;
  title?: string;
}) {
  const cls =
    tone === "brand"
      ? "chip chip-brand"
      : tone === "solid"
        ? "chip chip-solid"
        : tone === "alert"
          ? "chip chip-alert"
          : tone === "caution"
            ? "chip chip-caution"
            : "chip";
  return (
    <span className={cls} title={title}>
      {children}
    </span>
  );
}

export function StatusBadge({
  state,
  label,
}: {
  state: "live" | "idle" | "failed" | "ok";
  label: string;
}) {
  const tone: ChipTone =
    state === "failed" ? "alert" : state === "live" ? "brand" : "plain";
  return (
    <Chip tone={tone}>
      <span className={`dot ${state === "live" ? "pulse" : ""}`} />
      {label}
    </Chip>
  );
}

/* ------------------------------------------------------------------ *
 * Lattice — shared-hairline grid.
 * Container draws top+left, cells draw right+bottom.
 * ------------------------------------------------------------------ */

export function Lattice({
  cols,
  children,
  className = "",
}: {
  cols: number;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`lattice ${className}`}
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {children}
    </div>
  );
}

export function Cell({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "alert" | "caution";
}) {
  return (
    <div>
      <div className="t-label">{label}</div>
      <div
        className="t-stat mt-1"
        style={
          tone === "alert"
            ? { color: "var(--alert)" }
            : tone === "caution"
              ? { color: "var(--caution)" }
              : undefined
        }
      >
        {value}
      </div>
      {sub && <div className="t-label mt-1 normal-case tracking-normal">{sub}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Meter — segmented capacity strip. Discrete blocks for a discrete
 * quantity; here, an originality score out of 100 in 20 blocks.
 * ------------------------------------------------------------------ */

export function Meter({
  value,
  max = 100,
  segments = 20,
  tone = "brand",
}: {
  value: number;
  max?: number;
  segments?: number;
  tone?: "brand" | "alert" | "caution";
}) {
  const filled = Math.round((Math.max(0, Math.min(value, max)) / max) * segments);
  const onClass =
    tone === "alert"
      ? "meter-seg meter-seg-alert"
      : tone === "caution"
        ? "meter-seg meter-seg-caution"
        : "meter-seg meter-seg-on";

  return (
    <div
      className="meter"
      role="meter"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      {Array.from({ length: segments }, (_, i) => (
        <span key={i} className={i < filled ? onClass : "meter-seg"} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Copy button — the control used most, so it reports back.
 * ------------------------------------------------------------------ */

export function CopyButton({
  text,
  label = "Copy",
  className = "btn btn-sm",
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
        } catch {
          // Clipboard blocked (insecure origin / permissions) — say nothing
          // false. Leaving the label unchanged is the honest signal.
        }
      }}
    >
      {copied ? "Copied" : label}
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * Field
 * ------------------------------------------------------------------ */

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="t-label block mb-1">{label}</span>
      {children}
      {hint && (
        <span className="t-label block mt-1 normal-case tracking-normal">
          {hint}
        </span>
      )}
    </label>
  );
}
