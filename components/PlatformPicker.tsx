"use client";

import { PLATFORMS, PLATFORM_IDS, type PlatformId } from "@/lib/platforms";

/**
 * Which platform's format the copy gets written for.
 *
 * Shown before generating rather than after, because it changes what the model
 * writes — a LinkedIn intro that truncates at 150 characters is a different
 * craft problem from a 280-character post, not a reformat of one.
 */
export function PlatformPicker({
  value,
  onChange,
  disabled,
}: {
  value: PlatformId;
  onChange: (id: PlatformId) => void;
  disabled?: boolean;
}) {
  const spec = PLATFORMS[value];

  return (
    <div>
      <div className="flex items-center gap-1 flex-wrap">
        <span className="t-label mr-1">Write for:</span>
        {PLATFORM_IDS.map((id) => (
          <button
            key={id}
            type="button"
            className={`chip cursor-pointer ${value === id ? "chip-solid" : ""}`}
            onClick={() => onChange(id)}
            disabled={disabled}
            title={PLATFORMS[id].note}
          >
            {PLATFORMS[id].label}
          </button>
        ))}
      </div>
      <p className="t-label normal-case tracking-normal mt-1.5">
        {spec.formatName} ·{" "}
        {spec.fields
          .map((f) =>
            f.recommended
              ? `${f.label} ${f.recommended}/${f.max}`
              : `${f.label} ${f.max}`,
          )
          .join(" · ")}
      </p>
    </div>
  );
}
