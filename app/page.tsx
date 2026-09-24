"use client";

import * as React from "react";
import Link from "next/link";
import { BrandProfilePanel, useBrandProfile } from "@/components/BrandProfilePanel";
import { DnaPanel } from "@/components/DnaPanel";
import { OriginalCard } from "@/components/OriginalCard";
import { VariationCard } from "@/components/VariationCard";
import { VariationSkeletonRow } from "@/components/VariationSkeleton";
import { PlatformPicker } from "@/components/PlatformPicker";
import { getPlatform, type PlatformId } from "@/lib/platforms";
import { Field, Panel, StatusBadge } from "@/components/primitives";
import {
  createEventParser,
  RAIL_STAGES,
  STAGE_LABELS,
  type Stage,
} from "@/lib/ai/events";
import {
  ANGLE_LABELS,
  DEFAULT_ANGLES,
  angles as ALL_ANGLES,
  hasBrand,
  type AdDna,
  type Angle,
} from "@/lib/ai/schemas";
import type { ScoredVariation } from "@/lib/ai/variations";
import type { SourcePost } from "@/lib/x/types";
import type { ImageChoice } from "@/lib/ai/provider";

type Setup = {
  provider: { label: string; envVar: string; signupUrl: string } | null;
  imageProvider: string | null;
  canGenerateImages: boolean;
  imageChoices: ImageChoice[];
};

const STAGES: Stage[] = RAIL_STAGES;

const SAMPLES = [
  {
    label: "listicle · no creative read",
    url: "https://x.com/gregisenberg/status/1827692081109721502",
  },
  {
    label: "hook + image",
    url: "https://x.com/yasser_elsaid_/status/1682818914923716609",
  },
];

export default function Page() {
  const [url, setUrl] = React.useState("");
  const [running, setRunning] = React.useState(false);
  const [stage, setStage] = React.useState<Stage | null>(null);
  const [statusText, setStatusText] = React.useState("");
  const [post, setPost] = React.useState<SourcePost | null>(null);
  const [imageAnalysed, setImageAnalysed] = React.useState<boolean | undefined>();
  const [dna, setDna] = React.useState<AdDna | null>(null);
  const [variations, setVariations] = React.useState<ScoredVariation[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [showManual, setShowManual] = React.useState(false);
  const [manualText, setManualText] = React.useState("");
  const [manualImage, setManualImage] = React.useState("");
  const [uploadError, setUploadError] = React.useState<string | null>(null);

  // angle -> the creative plus the prompt that actually rendered it.
  const [images, setImages] = React.useState<
    Record<string, { dataUrl: string; prompt: string }>
  >({});
  const [saveState, setSaveState] = React.useState<
    { status: "idle" } | { status: "saving" } | { status: "saved" } | { status: "error"; message: string }
  >({ status: "idle" });

  // Elapsed time is the cheapest possible proof that the run is still alive.
  const [elapsed, setElapsed] = React.useState(0);
  const startedAt = React.useRef<number | null>(null);

  // The counter is reset in run(), not here — resetting inside the effect
  // would be a setState during render-commit rather than a user action.
  React.useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      if (startedAt.current) {
        setElapsed((Date.now() - startedAt.current) / 1000);
      }
    }, 100);
    return () => clearInterval(id);
  }, [running]);

  const [targetPlatform, setTargetPlatform] = React.useState<PlatformId>("x");
  const [selectedAngles, setSelectedAngles] =
    React.useState<Angle[]>(DEFAULT_ANGLES);

  const [setup, setSetup] = React.useState<Setup | null>(null);

  // Which provider is actually live decides what the image picker may offer.
  React.useEffect(() => {
    const controller = new AbortController();
    fetch("/api/setup", { signal: controller.signal })
      .then((r) => r.json())
      .then((d: Setup) => setSetup(d))
      .catch(() => {
        /* The studio still works; only the picker loses its options. */
      });
    return () => controller.abort();
  }, []);

  const brandCtl = useBrandProfile();
  const abortRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => () => abortRef.current?.abort(), []);

  async function run(useManual = false) {
    if (running) return;
    if (!useManual && !url.trim()) return;
    if (useManual && !manualText.trim()) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setRunning(true);
    startedAt.current = Date.now();
    setElapsed(0);
    setError(null);
    setPost(null);
    setDna(null);
    setVariations(null);
    setImageAnalysed(undefined);
    setImages({});
    setSaveState({ status: "idle" });
    setStage("fetching");
    setStatusText(STAGE_LABELS.fetching);

    try {
      const res = await fetch("/api/clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          url: useManual ? undefined : url.trim(),
          manual: useManual
            ? { text: manualText, imageUrl: manualImage.trim() || undefined }
            : undefined,
          targetPlatform,
          angles: selectedAngles,
          brand:
            brandCtl.enabled && hasBrand(brandCtl.brand) ? brandCtl.brand : null,
        }),
      });

      if (!res.ok && !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status}).`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream.");

      const decoder = new TextDecoder();
      const parse = createEventParser();

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        for (const event of parse(decoder.decode(value, { stream: true }))) {
          switch (event.type) {
            case "status":
              setStage(event.stage);
              setStatusText(event.message);
              break;
            case "post":
              setPost(event.post);
              setImageAnalysed(event.imageAnalysed);
              break;
            case "dna":
              setDna(event.dna);
              break;
            case "variations":
              setVariations(event.variations);
              break;
            case "error":
              setError(event.message);
              if (event.recoverable) setShowManual(true);
              break;
            case "done":
              setStage("done");
              break;
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  async function saveRun() {
    if (!post || !dna || !variations) return;
    setSaveState({ status: "saving" });
    try {
      const res = await fetch("/api/swipes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          post,
          dna,
          variations,
          images,
          platform: targetPlatform,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not save.");
      setSaveState({ status: "saved" });
    } catch (err) {
      setSaveState({
        status: "error",
        message: err instanceof Error ? err.message : "Could not save.",
      });
    }
  }

  const writingStage =
    running && (stage === "writing" || stage === "checking" || stage === "rewriting")
      ? (stage as "writing" | "checking" | "rewriting")
      : null;

  const status = error ? "failed" : running ? "live" : variations ? "ok" : "idle";

  return (
    <main className="mx-auto w-full max-w-[1400px] px-4 py-6 flex flex-col gap-4">
      {/* Header */}
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="t-h1">AdClone Studio</h1>
          <p className="t-label normal-case tracking-normal mt-1 max-w-[62ch]">
            Paste an X post that performed. The studio reads its framework, then
            rebuilds it as three fresh angles — new words, new creative, checked
            against the original so nothing is lifted.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {setup?.provider && (
            <span className="chip" title={`Analysis via ${setup.provider.envVar}`}>
              {setup.provider.label}
            </span>
          )}
          {setup?.imageProvider && setup.imageProvider !== setup.provider?.label && (
            <span className="chip" title="Renders the creative">
              {setup.imageProvider}
            </span>
          )}
        <StatusBadge
          state={status === "ok" ? "idle" : (status as "live" | "idle" | "failed")}
          label={
            error
              ? "failed"
              : running
                ? statusText || "working"
                : variations
                  ? "ready"
                  : "idle"
          }
        />
        </div>
      </header>

      {/* No provider configured — say what to do, before anything fails. */}
      {setup && !setup.provider && (
        <Panel bodyClassName="p-3">
          <div className="flex items-start gap-2">
            <span className="chip chip-caution shrink-0">setup</span>
            <div>
              <p className="text-[12px] leading-[1.5]">
                No model provider is configured. Add one key to{" "}
                <code className="sunken px-1">.env.local</code> and restart.
              </p>
              <p className="t-label normal-case tracking-normal mt-1.5">
                <a
                  className="underline underline-offset-2"
                  href="https://aistudio.google.com/apikey"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Google AI Studio
                </a>{" "}
                has a free tier covering both the vision pass and image
                generation — set{" "}
                <code>GOOGLE_GENERATIVE_AI_API_KEY</code>. Also accepted:{" "}
                <code>AI_GATEWAY_API_KEY</code>, <code>ANTHROPIC_API_KEY</code>,{" "}
                <code>OPENAI_API_KEY</code>.
              </p>
            </div>
          </div>
        </Panel>
      )}

      {/* Command row */}
      <Panel bodyClassName="p-3">
        <div className="flex gap-2 flex-wrap sm:flex-nowrap">
          <input
            className="input flex-1 min-w-[240px]"
            placeholder="https://x.com/handle/status/1234567890…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void run(false);
            }}
            spellCheck={false}
            aria-label="X post URL"
          />
          <button
            type="button"
            className="btn btn-primary shrink-0"
            onClick={() => void run(false)}
            disabled={running || !url.trim()}
          >
            {running ? "Working…" : "Clone"}
          </button>
        </div>

        <div className="mt-3 pt-3 border-t border-[var(--rule)]">
          <PlatformPicker
            value={targetPlatform}
            onChange={setTargetPlatform}
            disabled={running}
          />
        </div>

        <div className="mt-3 pt-3 border-t border-[var(--rule)]">
          <div className="flex items-center gap-1 flex-wrap">
            <span className="t-label mr-1">Angles:</span>
            {ALL_ANGLES.map((angle) => {
              const on = selectedAngles.includes(angle);
              return (
                <button
                  key={angle}
                  type="button"
                  className={`chip cursor-pointer ${on ? "chip-brand" : ""}`}
                  title={ANGLE_LABELS[angle].blurb}
                  disabled={running}
                  onClick={() =>
                    setSelectedAngles((prev) =>
                      // Never let the selection empty out — a run with no
                      // angles would just fail at the schema.
                      prev.includes(angle)
                        ? prev.length > 1
                          ? prev.filter((a) => a !== angle)
                          : prev
                        : [...prev, angle],
                    )
                  }
                >
                  {ANGLE_LABELS[angle].label}
                </button>
              );
            })}
          </div>
          <p className="t-label normal-case tracking-normal mt-1.5">
            {selectedAngles.length} selected · each is one model-written
            variation, and they are checked against each other as well as the
            source.
          </p>
        </div>

        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[var(--rule)] flex-wrap">
          <span className="t-label">Try:</span>
          {SAMPLES.map((s) => (
            <button
              key={s.url}
              type="button"
              className="chip cursor-pointer"
              onClick={() => setUrl(s.url)}
              disabled={running}
            >
              {s.label}
            </button>
          ))}
          <button
            type="button"
            className="t-label ml-auto underline underline-offset-2 hover:text-[var(--ink)] cursor-pointer"
            onClick={() => setShowManual((v) => !v)}
          >
            {showManual ? "Hide manual paste" : "Paste a post manually"}
          </button>
        </div>

        {/* Stage rail */}
        {(running || stage) && (
          <div className="mt-3 pt-3 border-t border-[var(--rule)]">
            <div className="flex gap-1.5 flex-wrap items-center">
              {STAGES.map((s, i) => {
                // `rewriting` is a detour off `checking`, so it lights that chip.
                const effective = stage === "rewriting" ? "checking" : stage;
                const effectiveIndex = effective
                  ? STAGES.indexOf(effective as Stage)
                  : -1;
                const done =
                  stage === "done" || (effectiveIndex > -1 && i < effectiveIndex);
                const active = effective === s && running;
                const isRewrite = active && stage === "rewriting";

                return (
                  <span
                    key={s}
                    className={`chip ${done ? "chip-brand" : active ? "chip-solid" : ""}`}
                    style={
                      isRewrite
                        ? { background: "var(--caution)", borderColor: "transparent", color: "#fff" }
                        : undefined
                    }
                  >
                    {active && <span className="dot pulse" />}
                    {isRewrite ? STAGE_LABELS.rewriting : STAGE_LABELS[s]}
                  </span>
                );
              })}

              {running && (
                <span className="t-label tabular-nums ml-auto">
                  {elapsed.toFixed(1)}s
                </span>
              )}
            </div>

            {running && statusText && (
              <p className="t-label normal-case tracking-normal mt-2 caret">
                {statusText}
              </p>
            )}
          </div>
        )}
      </Panel>

      {/* Manual paste — the universal input. LinkedIn, Meta and Google all
          front their ad libraries with bot protection, so pasting is not a
          fallback for those platforms, it is the way in. */}
      {showManual && (
        <Panel title="Paste an ad" bodyClassName="p-3">
          <p className="t-label normal-case tracking-normal mb-2">
            Works for any platform. LinkedIn, Meta and Google ad libraries block
            automated reads, so paste their copy and drop in a screenshot —
            everything downstream is identical.
          </p>
          <textarea
            className="input"
            rows={6}
            placeholder="Paste the full ad copy…"
            value={manualText}
            onChange={(e) => setManualText(e.target.value)}
          />

          <div className="grid gap-2 sm:grid-cols-2 mt-2">
            <Field label="Creative — upload" hint="Screenshot the ad. Max 6 MB.">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="input pt-1"
                disabled={running}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 6 * 1024 * 1024) {
                    setUploadError("That image is over 6 MB.");
                    return;
                  }
                  setUploadError(null);
                  const reader = new FileReader();
                  reader.onload = () => setManualImage(String(reader.result));
                  reader.onerror = () => setUploadError("Could not read that file.");
                  reader.readAsDataURL(file);
                }}
              />
            </Field>
            <Field label="…or paste an image URL">
              <input
                className="input"
                placeholder="https://…"
                value={manualImage.startsWith("data:") ? "" : manualImage}
                onChange={(e) => setManualImage(e.target.value)}
                spellCheck={false}
              />
            </Field>
          </div>

          {uploadError && (
            <p className="text-[11px] mt-1" style={{ color: "var(--alert)" }}>
              {uploadError}
            </p>
          )}

          {manualImage.startsWith("data:") && (
            <div className="sunken p-1 mt-2 max-w-[260px]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={manualImage} alt="Uploaded creative" className="w-full block" />
            </div>
          )}

          <button
            type="button"
            className="btn btn-primary mt-2"
            onClick={() => void run(true)}
            disabled={running || !manualText.trim()}
          >
            Clone pasted ad
          </button>
        </Panel>
      )}

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

      {/* Results */}
      {(post || dna) && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] items-start">
          {post && <OriginalCard post={post} imageAnalysed={imageAnalysed} />}
          {dna ? (
            <DnaPanel dna={dna} />
          ) : (
            <Panel
              title="Ad DNA"
              className="scanning"
              right={
                <span className="chip">
                  <span className="dot pulse" />
                  working
                </span>
              }
              bodyClassName="p-3"
            >
              <p className="t-label normal-case tracking-normal mb-3 caret">
                {post?.media.length
                  ? "Reading the copy and the creative"
                  : "Reading the copy"}
              </p>
              <div className="t-label mb-2">Structure</div>
              <div className="flex gap-1 mb-3">
                {[64, 78, 52].map((w, i) => (
                  <span
                    key={i}
                    className="skeleton"
                    style={{ width: w, height: 20 }}
                  />
                ))}
              </div>
              <div className="sunken p-2.5 mb-3">
                <span className="skeleton skeleton-line" style={{ width: "88%" }} />
                <span className="skeleton skeleton-line" style={{ width: "64%" }} />
              </div>
              {["Audience", "Pain state", "Triggers", "Proof", "CTA"].map((label, i) => (
                <div
                  key={label}
                  className="grid grid-cols-[92px_minmax(0,1fr)] gap-3 py-1.5 border-t border-[var(--rule)]"
                >
                  <div className="t-label pt-0.5">{label}</div>
                  <span
                    className="skeleton skeleton-line mt-1"
                    style={{ width: `${[82, 70, 58, 44, 66][i]}%` }}
                  />
                </div>
              ))}
            </Panel>
          )}
        </div>
      )}

      <BrandProfilePanel {...brandCtl} />

      {/* Placeholders while the variations are being written. This is the
          longest stretch of the run, and doubles when the guard forces a
          rewrite — so the three slots appear immediately, labelled. */}
      {!variations && writingStage && (
        <section className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <h2 className="t-section">Variations</h2>
            <span className="t-label">
              {writingStage === "rewriting"
                ? "the guard rejected a draft — going again"
                : `${selectedAngles.length} angle${selectedAngles.length === 1 ? "" : "s"} from the same DNA`}
            </span>
          </div>
          <VariationSkeletonRow stage={writingStage} />
        </section>
      )}

      {variations && (
        <section className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <h2 className="t-section">Variations</h2>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="t-label">
                {variations.filter((v) => v.originality.pass).length}/
                {variations.length} pass the originality check
              </span>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => void saveRun()}
                disabled={saveState.status === "saving" || saveState.status === "saved"}
              >
                {saveState.status === "saving"
                  ? "Saving…"
                  : saveState.status === "saved"
                    ? "Saved"
                    : "Save run"}
              </button>
              <Link href="/library" className="btn btn-sm">
                Swipe file
              </Link>
            </div>
          </div>

          {saveState.status === "error" && (
            <p className="text-[11px] leading-[1.45]" style={{ color: "var(--alert)" }}>
              {saveState.message}
            </p>
          )}
          <div className="grid gap-4 lg:grid-cols-3 items-start">
            {variations.map((v, i) => (
              <div key={v.angle} className="rise" style={{ animationDelay: `${i * 70}ms` }}>
              <VariationCard
                variation={v}
                referenceImageUrl={post?.media[0]?.url}
                imageChoices={setup?.imageChoices ?? []}
                platform={getPlatform(targetPlatform)}
                onImageGenerated={(angle, dataUrl, prompt) =>
                  setImages((prev) => ({ ...prev, [angle]: { dataUrl, prompt } }))
                }
              />
              </div>
            ))}
          </div>
        </section>
      )}

      {running && !variations && (
        <Panel bodyClassName="p-3">
          <span className="t-label pulse">{statusText || "Working…"}</span>
        </Panel>
      )}

      <footer className="t-label normal-case tracking-normal pt-2">
        Reads public posts and writes original derivative copy. The originality
        check is enforced in code, not left to the model.
      </footer>
    </main>
  );
}
