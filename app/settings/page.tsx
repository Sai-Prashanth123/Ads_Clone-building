"use client";

import * as React from "react";
import {
  BrandProfilePanel,
  useBrandProfile,
} from "@/components/BrandProfilePanel";
import { Chip, Panel, StatusBadge } from "@/components/primitives";
import { PLATFORMS, PLATFORM_IDS } from "@/lib/platforms";
import type { ImageChoice } from "@/lib/ai/provider";

type Setup = {
  provider: { label: string; envVar: string; signupUrl: string } | null;
  imageProvider: string | null;
  canGenerateImages: boolean;
  imageChoices: ImageChoice[];
};

export default function SettingsPage() {
  const [setup, setSetup] = React.useState<Setup | null>(null);
  const [swipeFile, setSwipeFile] = React.useState<"on" | "off" | "checking">(
    "checking",
  );
  const brandCtl = useBrandProfile();

  React.useEffect(() => {
    const controller = new AbortController();

    fetch("/api/setup", { signal: controller.signal })
      .then((r) => r.json())
      .then((d: Setup) => setSetup(d))
      .catch(() => {});

    // 503 from the swipe file means Supabase is not configured — a real
    // deployment state worth showing rather than discovering on first save.
    fetch("/api/swipes?limit=1", { signal: controller.signal })
      .then((r) => setSwipeFile(r.ok ? "on" : "off"))
      .catch(() => {});

    return () => controller.abort();
  }, []);

  return (
    <main className="mx-auto w-full max-w-[1100px] px-4 py-6 flex flex-col gap-4">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="t-h1">Settings</h1>
          <p className="t-label normal-case tracking-normal mt-1 max-w-[62ch]">
            What this deployment can actually do, read from the server rather
            than assumed.
          </p>
        </div>
        <StatusBadge
          state={setup?.provider ? "idle" : "failed"}
          label={setup?.provider ? "configured" : "no provider"}
        />
      </header>

      <Panel title="Providers" bodyClassName="p-3">
        <div className="divide-y divide-[var(--rule)]">
          <div className="grid grid-cols-[130px_minmax(0,1fr)] gap-3 py-2">
            <span className="t-label pt-0.5">Analysis</span>
            <span className="text-[12px] text-[var(--ink-2)]">
              {setup?.provider ? (
                <>
                  {setup.provider.label}
                  <span className="t-muted"> · {setup.provider.envVar}</span>
                </>
              ) : (
                <span style={{ color: "var(--alert)" }}>
                  No key set. Add GOOGLE_GENERATIVE_AI_API_KEY (free tier) to
                  .env.local.
                </span>
              )}
            </span>
          </div>

          <div className="grid grid-cols-[130px_minmax(0,1fr)] gap-3 py-2">
            <span className="t-label pt-0.5">Creative</span>
            <span className="text-[12px] text-[var(--ink-2)]">
              {setup?.imageProvider ?? "none — prompts are handed to you instead"}
            </span>
          </div>

          <div className="grid grid-cols-[130px_minmax(0,1fr)] gap-3 py-2">
            <span className="t-label pt-0.5">Image models</span>
            <span className="flex flex-wrap gap-1">
              {setup?.imageChoices.length ? (
                setup.imageChoices.map((c) => (
                  <Chip key={c.id} title={c.note}>
                    {c.label}
                  </Chip>
                ))
              ) : (
                <span className="t-label normal-case tracking-normal">none</span>
              )}
            </span>
          </div>

          <div className="grid grid-cols-[130px_minmax(0,1fr)] gap-3 py-2">
            <span className="t-label pt-0.5">Swipe file</span>
            <span className="text-[12px] text-[var(--ink-2)]">
              {swipeFile === "checking" ? (
                <span className="pulse">checking…</span>
              ) : swipeFile === "on" ? (
                "Connected. Runs and batches persist."
              ) : (
                "Not configured — the studio works, it just won't remember anything."
              )}
            </span>
          </div>
        </div>

        <p className="t-label normal-case tracking-normal mt-3 pt-3 border-t border-[var(--rule)]">
          Keys are server-side only and never reach the browser. Change them in
          <code className="sunken px-1 mx-1">.env.local</code> locally, or in the
          Render dashboard for the deployed service, then restart.
        </p>
      </Panel>

      <BrandProfilePanel {...brandCtl} />

      <Panel title="Platform formats" bodyClassName="p-3">
        <p className="t-label normal-case tracking-normal mb-3">
          Limits enforced in code on every generated variation. Over a hard
          limit is a failure, past the truncation point is a warning.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {PLATFORM_IDS.map((id) => {
            const spec = PLATFORMS[id];
            return (
              <div key={id} className="sunken p-2.5">
                <div className="flex items-baseline justify-between mb-1.5">
                  <span className="text-[12px] font-semibold">{spec.label}</span>
                  <span className="t-label">{spec.formatName}</span>
                </div>
                <ul className="space-y-1">
                  {spec.fields.map((f) => (
                    <li
                      key={f.key}
                      className="flex items-baseline justify-between gap-2"
                    >
                      <span className="text-[11px] text-[var(--ink-2)] truncate">
                        {f.label}
                        {f.repeat && ` ×${f.repeat.min}–${f.repeat.max}`}
                      </span>
                      <span className="t-label tabular-nums shrink-0">
                        {f.recommended ? `${f.recommended} / ` : ""}
                        {f.max}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-1 mt-2">
                  {spec.aspectRatios.map((r) => (
                    <Chip key={r}>{r}</Chip>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </Panel>
    </main>
  );
}
