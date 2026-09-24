import type { FieldSpec, FormatSpec, GroupSpec, PlatformSpec } from "./types";

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

/**
 * A repeating group — carousel cards, thread posts.
 *
 * Distinct from `repeat`, which repeats one field. A card carries several
 * fields at once, N cards over, so each entry is validated as a small record
 * and reported by position: "Card 3 headline is 6 over" beats "a headline
 * somewhere is too long".
 */
function checkGroup(
  raw: unknown,
  group: GroupSpec,
): { reports: FieldReport[]; problems: string[] } {
  const items = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
  const problems: string[] = [];

  if (items.length < group.min || items.length > group.max) {
    problems.push(
      `${group.label}: ${items.length} supplied, needs ${group.min}–${group.max}.`,
    );
  }

  const reports: FieldReport[] = [];

  items.forEach((item, index) => {
    for (const field of group.fields) {
      const value = item?.[field.key];
      const text = typeof value === "string" ? value : "";
      const report = checkSingle(text, field);

      const label = `${group.itemLabel} ${index + 1} · ${field.label}`;
      reports.push({ ...report, key: `${group.key}[${index}].${field.key}`, label });

      if (report.message) {
        problems.push(report.message.replace(field.label, label));
      }
    }
  });

  return { reports, problems };
}

export function validateAgainstSpec(
  spec: PlatformSpec | FormatSpec,
  fields: Record<string, unknown>,
): SpecReport {
  const reports = spec.fields.map((field) => {
    const raw = fields[field.key];

    if (field.repeat) {
      const values = Array.isArray(raw) ? (raw as string[]) : raw ? [String(raw)] : [];
      return checkRepeated(values, field);
    }

    const value = Array.isArray(raw) ? raw.join(" ") : ((raw as string) ?? "");
    return checkSingle(value, field);
  });

  const problems = reports
    .map((r) => r.message)
    .filter((m): m is string => Boolean(m));

  // Groups append their own positional reports and problems.
  const groupStatuses: FieldStatus[] = [];
  for (const group of spec.groups ?? []) {
    const result = checkGroup(fields[group.key], group);
    reports.push(...result.reports);
    problems.push(...result.problems);

    const countWrong = result.problems.some((p) => p.includes("needs"));
    if (countWrong) groupStatuses.push("count");
  }

  const allOk = (r: FieldReport) => r.status === "ok" || r.status === "warn";

  return {
    platform: "id" in spec ? spec.id : "unknown",
    pass: reports.every(allOk) && groupStatuses.length === 0,
    hasWarnings: reports.some((r) => r.status === "warn"),
    fields: reports,
    problems,
  };
}
