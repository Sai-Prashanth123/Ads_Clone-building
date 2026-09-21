"use client";

import * as React from "react";
import { Chip, CopyButton, Meter, Panel } from "./primitives";
import type { AspectRatio } from "@/lib/platforms";
import type { ImageChoice } from "@/lib/ai/provider";
import type { PlatformSpec } from "@/lib/platforms";
import { ANGLE_LABELS, type Angle } from "@/lib/ai/schemas";
import type { ScoredVariation } from "@/lib/ai/variations";

type ImageState =
  | { status: "idle" }
  | { status: "working" }
  | { status: "done"; dataUrl: string; model: string }
  | { status: "error"; message: string };

function scoreTone(score: number, pass: boolean) {
  if (!pass) return "alert" as const;
  if (score < 75) return "caution" as const;
  return "brand" as const;
}

export function VariationCard({
  variation,
  referenceImageUrl,
  imageChoices,
  platform,
  onImageGenerated,
}: {
  variation: ScoredVariation;
  referenceImageUrl?: string;
  imageChoices: ImageChoice[];
  /** Which platform's fields this variation was written for. */
  platform: PlatformSpec;
  /** Lifts the rendered creative up so a saved run keeps its image, along
   *  with the prompt that produced it — which may have been edited here. */
  onImageGenerated?: (angle: string, dataUrl: string, prompt: string) => void;
}) {
  const [model, setModel] = React.useState<string>(imageChoices[0]?.id ?? "");
  const [aspect, setAspect] = React.useState<AspectRatio>(platform.defaultAspect);
  const [image, setImage] = React.useState<ImageState>({ status: "idle" });
  const [showPrompt, setShowPrompt] = React.useState(false);

  // The model's prompt is a starting point, not a verdict. Keeping the edit
  // separate from variation.imagePrompt means "Reset" always has something
  // true to go back to, and the card can say which one made the picture.
  const [promptDraft, setPromptDraft] = React.useState(variation.imagePrompt);
  const [negativesDraft, setNegativesDraft] = React.useState(
    variation.imageNegatives,
  );

  const promptEdited =
    promptDraft !== variation.imagePrompt ||
    negativesDraft !== variation.imageNegatives;

  const meta = ANGLE_LABELS[variation.angle as Angle];
  const { originality: o } = variation;
  const tone = scoreTone(o.score, o.pass);
  const spec = imageChoices.find((m) => m.id === model) ?? imageChoices[0];

  async function generate() {
    setImage({ status: "working" });
    try {
      const res = await fetch("/api/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: promptDraft,
          negatives: negativesDraft,
          model,
          aspectRatio: aspect,
          ...(spec.supportsImageInput && referenceImageUrl
            ? { referenceImageUrl }
            : {}),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Image generation failed.");
      setImage({ status: "done", dataUrl: body.dataUrl, model: body.model });
      // Report the prompt that actually produced this image, not the one the
      // model first proposed — otherwise a saved run records a prompt that
      // never ran.
      onImageGenerated?.(variation.angle, body.dataUrl, promptDraft);
    } catch (err) {
      setImage({
        status: "error",
        message: err instanceof Error ? err.message : "Image generation failed.",
      });
    }
  }

  return (
    <Panel
      hover
      className="flex flex-col"
      title={meta?.label ?? variation.angle}
      right={
        <div className="flex items-center gap-1.5">
          {variation.regenerated && (
            <Chip title="This draft was rewritten after failing the originality check.">
              rewritten
            </Chip>
          )}
          <Chip tone={tone === "brand" ? "brand" : tone}>{o.score}/100</Chip>
        </div>
      }
      bodyClassName="p-3 flex flex-col gap-3 flex-1"
    >
      <p className="t-label normal-case tracking-normal">{variation.rationale}</p>

      {/* The copy, in the target platform's actual fields */}
      {platform.fields.map((field) => {
        const raw = variation.fields?.[field.key];
        const values = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
        const report = variation.spec?.fields.find((f) => f.key === field.key);

        // Fall back to the flat text when a variation predates the platform
        // layer, so old saved runs still render.
        if (values.length === 0 && field.key === platform.fields[0].key) {
          values.push(variation.text);
        }
        if (values.length === 0) return null;

        const fieldTone =
          report?.status === "over" || report?.status === "count"
            ? "var(--alert)"
            : report?.status === "warn"
              ? "var(--caution)"
              : undefined;

        return (
          <div key={field.key}>
            <div className="flex items-baseline justify-between mb-1">
              <span className="t-label">{field.label}</span>
              <span className="t-label tabular-nums" style={{ color: fieldTone }}>
                {report?.chars ?? values.join("").length}
                {field.recommended ? `/${field.recommended}` : `/${field.max}`}
              </span>
            </div>

            <div className="sunken p-2.5 flex flex-col gap-1.5">
              {values.map((value, i) => (
                <pre
                  key={i}
                  className="whitespace-pre-wrap break-words font-[inherit] text-[12px] leading-[1.55]"
                >
                  {value}
                </pre>
              ))}
            </div>

            {report?.message && (
              <p className="text-[11px] leading-[1.45] mt-1" style={{ color: fieldTone }}>
                {report.message}
              </p>
            )}
          </div>
        );
      })}

      <div className="flex items-center gap-1.5 flex-wrap">
        <CopyButton text={variation.text} label="Copy all" />
        {variation.spec && !variation.spec.pass && (
          <Chip tone="alert">off-spec</Chip>
        )}
        <span className="t-label ml-auto tabular-nums">
          {variation.text.length} chars total
        </span>
      </div>

      {/* Originality — the enforced contract, shown not claimed */}
      <div>
        <div className="flex items-baseline justify-between mb-1.5">
          <span className="t-label">Originality vs source</span>
          <span
            className="t-label tabular-nums"
            style={
              tone === "alert"
                ? { color: "var(--alert)" }
                : tone === "caution"
                  ? { color: "var(--caution)" }
                  : undefined
            }
          >
            {o.pass ? "pass" : "flagged"}
          </span>
        </div>
        <Meter value={o.score} tone={tone} />
        <div className="grid grid-cols-3 gap-2 mt-2">
          {[
            ["n-gram", `${(o.ngramOverlap * 100).toFixed(1)}%`],
            ["longest run", `${o.longestSharedRun}w`],
            ["rare words", `${(o.rareWordOverlap * 100).toFixed(0)}%`],
          ].map(([label, value]) => (
            <div key={label}>
              <div className="t-label">{label}</div>
              <div className="text-[12px] tabular-nums text-[var(--ink-2)]">
                {value}
              </div>
            </div>
          ))}
        </div>
        {!o.pass && (
          <ul className="mt-2 space-y-1">
            {o.reasons.map((r) => (
              <li
                key={r}
                className="text-[11px] leading-[1.45]"
                style={{ color: "var(--alert)" }}
              >
                {r}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Beat mapping — the receipt that the framework survived */}
      <details className="group">
        <summary className="t-label cursor-pointer select-none hover:text-[var(--ink)]">
          Beat mapping ({variation.beatMapping.length})
        </summary>
        <ol className="mt-2 divide-y divide-[var(--rule)] border-t border-[var(--rule)]">
          {variation.beatMapping.map((b, i) => (
            <li key={i} className="grid grid-cols-[76px_minmax(0,1fr)] gap-2 py-1.5">
              <span className="t-label pt-0.5">{b.role}</span>
              <span className="text-[11px] text-[var(--ink-2)] leading-[1.45] break-words">
                {b.line}
              </span>
            </li>
          ))}
        </ol>
      </details>

      {/* Image studio */}
      <div className="mt-auto pt-3 border-t border-[var(--rule)]">
        <div className="t-label mb-2">Creative</div>

        {!spec ? (
          <>
            <p className="t-label normal-case tracking-normal mb-2">
              The configured provider has no image model, so the prompt below is
              ready to paste into whichever tool you use.
            </p>
            <div className="sunken p-2.5">
              <p className="text-[11px] leading-[1.5] text-[var(--ink-2)] break-words">
                {variation.imagePrompt}
              </p>
              <div className="mt-2">
                <CopyButton text={variation.imagePrompt} label="Copy prompt" />
              </div>
            </div>
          </>
        ) : (
          <>
        <div className="flex flex-wrap gap-1 mb-2">
          {imageChoices.map((m) => (
            <button
              key={m.id}
              type="button"
              title={m.note}
              onClick={() => setModel(m.id)}
              className={`chip ${model === m.id ? "chip-solid" : ""} cursor-pointer`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-1 mb-2">
          {platform.aspectRatios.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setAspect(r)}
              className={`chip ${aspect === r ? "chip-brand" : ""} cursor-pointer`}
            >
              {r}
            </button>
          ))}
        </div>

        <p className="t-label normal-case tracking-normal mb-2">
          {spec.note} {spec.approxCost} per image.
          {spec.supportsImageInput && referenceImageUrl
            ? " The original creative will be passed in as reference."
            : ""}
        </p>

        {image.status === "done" && (
          <figure className="sunken p-1 mb-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={image.dataUrl}
              alt={variation.altText}
              className="w-full block"
            />
          </figure>
        )}

        {image.status === "working" && (
          <div className="sunken h-32 mb-2 flex items-center justify-center">
            <span className="t-label pulse">Rendering…</span>
          </div>
        )}

        {image.status === "error" && (
          <p
            className="text-[11px] leading-[1.45] mb-2"
            style={{ color: "var(--alert)" }}
          >
            {image.message}
          </p>
        )}

        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={generate}
            disabled={image.status === "working"}
          >
            {image.status === "done" ? "Regenerate" : "Generate image"}
          </button>

          {image.status === "done" && (
            <a
              className="btn btn-sm"
              href={image.dataUrl}
              download={`adclone-${variation.angle}.png`}
            >
              Download
            </a>
          )}

          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setShowPrompt((v) => !v)}
          >
            {showPrompt ? "Hide prompt" : "Prompt"}
          </button>
        </div>

        {showPrompt && (
          <div className="sunken p-2.5 mt-2">
            {variation.visualMechanism && (
              <>
                <div className="t-label mb-1">Mechanism carried over</div>
                <p className="text-[11px] leading-[1.5] text-[var(--ink)] mb-2">
                  {variation.visualMechanism}
                </p>
              </>
            )}
            <div className="flex items-baseline justify-between mb-1">
              <span className="t-label">Image prompt</span>
              {promptEdited && (
                <span className="t-label" style={{ color: "var(--brand-deep)" }}>
                  edited
                </span>
              )}
            </div>
            <textarea
              className="input text-[11px] leading-[1.5]"
              rows={7}
              value={promptDraft}
              onChange={(e) => setPromptDraft(e.target.value)}
              spellCheck={false}
              aria-label="Image prompt"
            />

            <div className="t-label mt-2 mb-1">Avoid</div>
            <textarea
              className="input text-[11px] leading-[1.5]"
              rows={2}
              value={negativesDraft}
              onChange={(e) => setNegativesDraft(e.target.value)}
              spellCheck={false}
              placeholder="photorealism, stock photo, watermark"
              aria-label="What the image must avoid"
            />

            <div className="flex items-center gap-1.5 flex-wrap mt-2">
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={generate}
                disabled={image.status === "working"}
              >
                {image.status === "working" ? "Rendering…" : "Render this prompt"}
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  setPromptDraft(variation.imagePrompt);
                  setNegativesDraft(variation.imageNegatives);
                }}
                disabled={!promptEdited}
              >
                Reset
              </button>
              <CopyButton text={promptDraft} label="Copy" />
              <span className="t-label ml-auto tabular-nums">
                {promptDraft.length} chars
              </span>
            </div>
          </div>
        )}
          </>
        )}
      </div>
    </Panel>
  );
}
