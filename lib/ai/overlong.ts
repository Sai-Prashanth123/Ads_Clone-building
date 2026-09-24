import { NoObjectGeneratedError } from "ai";
import { generationMax, type PlatformSpec } from "../platforms";
import type { FormatSpec } from "../platforms/types";

/**
 * Reading a schema rejection back into something a writer can act on.
 *
 * `generationMax` caps each copy field in the zod schema, which is what keeps a
 * 3,000-character allowance from being filled — that steer works and is worth
 * keeping. The cost is that ONE field two characters over rejects the entire
 * batch, and the AI SDK reports it as "response did not match schema": no field
 * name, no angle, no number. The operator sees a dead run and learns nothing,
 * and the pipeline aborts rather than doing what it does for every other guard
 * failure, which is to say what was wrong and ask again.
 *
 * So the rejected text is re-read here against the same limits. What comes back
 * is the list of fields that overran, by angle and by how much — which is both
 * a readable error and a good retry instruction.
 */

export type Overlong = {
  angle: string;
  field: string;
  label: string;
  chars: number;
  limit: number;
};

type LooseVariation = {
  angle?: unknown;
  copy?: Record<string, unknown>;
};

/** Every copy field in a format, including the ones inside card groups. */
function limits(spec: PlatformSpec | FormatSpec) {
  const flat = spec.fields.map((f) => ({
    key: f.key,
    label: f.label,
    limit: generationMax(f),
    group: null as string | null,
  }));

  for (const group of spec.groups ?? []) {
    for (const f of group.fields) {
      const noun = group.itemLabel.toLowerCase();
      flat.push({
        key: f.key,
        label: f.label.toLowerCase().startsWith(noun)
          ? f.label
          : `${group.itemLabel} ${f.label}`,
        limit: generationMax(f),
        group: group.key,
      });
    }
  }

  return flat;
}

/**
 * The fields a rejected draft overran, or an empty list when the rejection was
 * something else — a missing field, a bad enum, a truncated response.
 */
export function findOverlong(
  err: unknown,
  spec: PlatformSpec | FormatSpec,
): Overlong[] {
  if (!NoObjectGeneratedError.isInstance(err) || !err.text) return [];

  let parsed: { variations?: LooseVariation[] };
  try {
    parsed = JSON.parse(err.text) as { variations?: LooseVariation[] };
  } catch {
    // A truncated response is the other common rejection, and it is not this.
    return [];
  }

  // `null` and `"text"` are both valid JSON, so parsing succeeding says
  // nothing about the shape.
  if (!parsed || typeof parsed !== "object") return [];
  if (!Array.isArray(parsed.variations)) return [];

  const specs = limits(spec);
  const found: Overlong[] = [];

  parsed.variations.forEach((v, index) => {
    const angle = typeof v?.angle === "string" ? v.angle : `variation ${index + 1}`;
    const copy = v?.copy;
    if (!copy || typeof copy !== "object") return;

    for (const f of specs) {
      // A card group's fields live one level down, once per card.
      const holders: Record<string, unknown>[] = f.group
        ? Array.isArray(copy[f.group])
          ? (copy[f.group] as Record<string, unknown>[])
          : []
        : [copy];

      for (const holder of holders) {
        const value = holder?.[f.key];
        const values = Array.isArray(value) ? value : [value];

        for (const one of values) {
          if (typeof one !== "string" || one.length <= f.limit) continue;
          found.push({
            angle,
            field: f.key,
            label: f.label,
            chars: one.length,
            limit: f.limit,
          });
        }
      }
    }
  });

  return found;
}

/** One line per overrun, worded as the instruction the retry needs. */
export function overlongNotes(items: Overlong[]): string[] {
  return items.map(
    (o) =>
      `${o.label} in the ${o.angle} variation ran to ${o.chars} characters — ${o.chars - o.limit} over its ${o.limit}-character limit. Cut it, do not reword around it.`,
  );
}

/** The same thing said once, for an operator reading an error message. */
export function describeOverlong(items: Overlong[]): string {
  if (items.length === 0) return "";

  const worst = items.reduce((a, b) =>
    a.chars - a.limit >= b.chars - b.limit ? a : b,
  );

  return items.length === 1
    ? `The model wrote past a field limit: ${worst.label} in the ${worst.angle} variation was ${worst.chars} characters against a ${worst.limit} limit.`
    : `The model wrote past ${items.length} field limits — worst was ${worst.label} in the ${worst.angle} variation at ${worst.chars} characters against ${worst.limit}.`;
}
