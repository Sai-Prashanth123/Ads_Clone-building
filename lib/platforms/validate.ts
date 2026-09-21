import type { FieldSpec, PlatformSpec } from "./index";

/**
 * The platform-spec guard.
 *
 * Same principle as lib/originality.ts: a promise the product makes is enforced
 * in deterministic code, not left to the model's good intentions. The prompt
 * tells the model the limits, but models miscount characters constantly — and
 * a headline two over the limit is rejected by the ad platform, not by us.
 *
 * No AI, no network. Cheap enough to run on every keystroke in the UI.
 */

export type FieldStatus = "ok" | "warn" | "over" | "missing" | "count";

export type FieldReport = {
  key: string;
  label: string;
  chars: number;
  max: number;
  recommended?: number;
  status: FieldStatus;
  message?: string;
  /** Per-entry reports for repeated fields such as Google's short headlines. */
  entries?: { value: string; chars: number; status: FieldStatus }[];
};

export type SpecReport = {
  platform: string;
  /** False when any field is over a hard limit, missing, or miscounted. */
  pass: boolean;
  /** True when everything fits but something will truncate in feed. */
  hasWarnings: boolean;
  fields: FieldReport[];
  /** One line per problem, ready to show or feed back to the model. */
  problems: string[];
};

function statusFor(chars: number, field: FieldSpec): FieldStatus {
  if (chars === 0) return "missing";
  if (chars > field.max) return "over";
  if (field.recommended && chars > field.recommended) return "warn";
  return "ok";
}

function checkSingle(value: string, field: FieldSpec): FieldReport {
  const chars = value.trim().length;
  const status = statusFor(chars, field);

  const message =
    status === "over"
      ? `${field.label} is ${chars - field.max} over the ${field.max}-character limit.`
      : status === "missing"
        ? `${field.label} is empty.`
        : status === "warn"
          ? `${field.label} passes ${field.recommended} characters, where it truncates.`
          : undefined;

  return {
    key: field.key,
    label: field.label,
    chars,
    max: field.max,
    recommended: field.recommended,
    status,
    message,
  };
}

function checkRepeated(values: string[], field: FieldSpec): FieldReport {
  const repeat = field.repeat!;
  const entries = values.map((value) => {
    const chars = value.trim().length;
    return { value, chars, status: statusFor(chars, field) };
  });

  const overLimit = entries.filter((e) => e.status === "over");
  const wrongCount = values.length < repeat.min || values.length > repeat.max;

  const status: FieldStatus = wrongCount
    ? "count"
    : overLimit.length > 0
      ? "over"
      : entries.some((e) => e.status === "warn")
        ? "warn"
        : "ok";

  const message = wrongCount
    ? `${field.label}: ${values.length} supplied, needs ${repeat.min}–${repeat.max}.`
    : overLimit.length > 0
      ? `${overLimit.length} of ${values.length} ${field.label.toLowerCase()} exceed ${field.max} characters.`
      : undefined;

  return {
    key: field.key,
    label: field.label,
    // The longest entry is what decides whether this field is a problem.
    chars: entries.reduce((max, e) => Math.max(max, e.chars), 0),
    max: field.max,
    recommended: field.recommended,
    status,
    message,
    entries,
  };
}

export function validateAgainstSpec(
  spec: PlatformSpec,
  fields: Record<string, string | string[] | undefined>,
): SpecReport {
  const reports = spec.fields.map((field) => {
    const raw = fields[field.key];

    if (field.repeat) {
      const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
      return checkRepeated(values, field);
    }

    const value = Array.isArray(raw) ? raw.join(" ") : (raw ?? "");
    return checkSingle(value, field);
  });

  const problems = reports
    .map((r) => r.message)
    .filter((m): m is string => Boolean(m));

  return {
    platform: spec.id,
    pass: reports.every(
      (r) => r.status === "ok" || r.status === "warn",
    ),
    hasWarnings: reports.some((r) => r.status === "warn"),
    fields: reports,
    problems,
  };
}
