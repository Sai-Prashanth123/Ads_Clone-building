"use client";

import * as React from "react";
import { Chip, Field, Panel } from "./primitives";
import type { BrandProfile } from "@/lib/ai/schemas";
import {
  getServerSnapshot,
  getSnapshot,
  subscribe,
  writeBrandStore,
} from "@/lib/brand-store";

export function useBrandProfile() {
  const stored = React.useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const setBrand = React.useCallback(
    (brand: BrandProfile) => writeBrandStore({ ...stored, brand }),
    [stored],
  );

  const setEnabled = React.useCallback(
    (enabled: boolean) => writeBrandStore({ ...stored, enabled }),
    [stored],
  );

  return { brand: stored.brand, setBrand, enabled: stored.enabled, setEnabled };
}

export function BrandProfilePanel({
  brand,
  setBrand,
  enabled,
  setEnabled,
}: {
  brand: BrandProfile;
  setBrand: (b: BrandProfile) => void;
  enabled: boolean;
  setEnabled: (v: boolean) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const set = (k: keyof BrandProfile) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setBrand({ ...brand, [k]: e.target.value });

  const filled = Boolean(brand.productName?.trim() || brand.oneLiner?.trim());

  return (
    <Panel
      title="Brand profile"
      right={
        <div className="flex items-center gap-1.5">
          <Chip tone={enabled && filled ? "brand" : "plain"}>
            {enabled && filled ? "retargeting" : "generic rewrite"}
          </Chip>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            {open ? "Collapse" : "Edit"}
          </button>
        </div>
      }
      bodyClassName="p-3"
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => setEnabled(!enabled)}
          className="mt-0.5 w-8 h-4 border border-[var(--rule-strong)] flex items-center p-px shrink-0"
          style={{ background: enabled ? "var(--brand)" : "transparent" }}
        >
          <span
            className="block w-3.5 h-3 transition-transform"
            style={{
              background: enabled ? "var(--brand-deep)" : "var(--rule-strong)",
              transform: enabled ? "translateX(14px)" : "translateX(0)",
            }}
          />
        </button>
        <p className="t-label normal-case tracking-normal">
          {enabled
            ? filled
              ? "Clones will sell your product using the source's framework."
              : "Switched on, but no product named yet — add one below or the run falls back to a generic rewrite."
            : "Off: clones stay on the source's own subject, rewritten from scratch."}
        </p>
      </div>

      {open && (
        <div className="grid gap-2.5 mt-3 pt-3 border-t border-[var(--rule)] sm:grid-cols-2">
          <Field label="Product name">
            <input
              className="input"
              value={brand.productName ?? ""}
              onChange={set("productName")}
              placeholder="Northwind Analytics"
            />
          </Field>
          <Field label="One-liner">
            <input
              className="input"
              value={brand.oneLiner ?? ""}
              onChange={set("oneLiner")}
              placeholder="Turns raw warehouse data into board-ready charts"
            />
          </Field>
          <Field label="Audience">
            <input
              className="input"
              value={brand.audience ?? ""}
              onChange={set("audience")}
              placeholder="Heads of RevOps at 50–500 person B2B firms"
            />
          </Field>
          <Field label="Offer / CTA target">
            <input
              className="input"
              value={brand.offer ?? ""}
              onChange={set("offer")}
              placeholder="14-day trial, no card"
            />
          </Field>
          <Field label="Tone to hold">
            <input
              className="input"
              value={brand.tone ?? ""}
              onChange={set("tone")}
              placeholder="Dry, concrete, no hype"
            />
          </Field>
          <Field label="Brand colours" hint="Used in the generated image prompts.">
            <input
              className="input"
              value={brand.brandColors ?? ""}
              onChange={set("brandColors")}
              placeholder="#0A0A0B charcoal, #B9A8FF periwinkle"
            />
          </Field>
          <Field label="Link">
            <input
              className="input"
              value={brand.url ?? ""}
              onChange={set("url")}
              placeholder="northwind.io"
            />
          </Field>
          <Field label="Never use these words">
            <input
              className="input"
              value={brand.bannedWords ?? ""}
              onChange={set("bannedWords")}
              placeholder="revolutionary, game-changing, unlock"
            />
          </Field>
        </div>
      )}
    </Panel>
  );
}
