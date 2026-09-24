export type PlatformId = "x" | "linkedin" | "meta" | "google";

export type AspectRatio = "16:9" | "1:1" | "4:5" | "1.91:1" | "9:16";

export type FieldSpec = {
  key: string;
  label: string;
  /** Hard limit. Over this is a failure — the platform rejects the ad. */
  max: number;
  /** Truncation point. Over this is a warning: it runs, it stops being read. */
  recommended?: number;
  multiline?: boolean;
  /** A field the platform wants several of, e.g. Google's short headlines. */
  repeat?: { min: number; max: number };
  /**
   * A value picked from the platform's own closed list, rather than written.
   *
   * LinkedIn's CTA is a button label chosen from eight fixed strings. Marking
   * it keeps it out of the places that assume prose — it is not the field whose
   * character budget shapes the writing, and "write at most 28 characters" is
   * meaningless advice about a dropdown.
   */
  fixedChoice?: boolean;
  hint: string;
};

/**
 * A repeating GROUP of fields — a carousel card, a thread post.
 *
 * Distinct from `repeat`, which repeats one field. A carousel card carries a
 * headline AND body AND its own link, N times over, which the single-field
 * shape cannot express at all. That gap is why carousels and threads were
 * unrepresentable before.
 */
export type GroupSpec = {
  key: string;
  label: string;
  /** Singular noun for one entry: "Card", "Post". */
  itemLabel: string;
  min: number;
  max: number;
  fields: FieldSpec[];
  hint: string;
};

export type FormatSpec = {
  id: string;
  label: string;
  /** Shown in the picker, so the choice is informed. */
  note: string;
  fields: FieldSpec[];
  groups?: GroupSpec[];
  aspectRatios: AspectRatio[];
  defaultAspect: AspectRatio;
  ctaOptions?: string[];
};

export type PlatformSpec = {
  id: PlatformId;
  label: string;
  note: string;
  formats: FormatSpec[];

  /* The default format, flattened onto the platform.
   *
   * Every existing call site reads `spec.fields` and `spec.defaultAspect`
   * directly. Mirroring the first format keeps them working unchanged, so
   * adding formats stays additive instead of becoming a fifteen-file rewrite. */
  formatName: string;
  fields: FieldSpec[];
  groups?: GroupSpec[];
  aspectRatios: AspectRatio[];
  defaultAspect: AspectRatio;
  ctaOptions?: string[];
};

/** Build a platform from its formats, mirroring the first onto the top level. */
export function definePlatform(args: {
  id: PlatformId;
  label: string;
  note: string;
  formats: FormatSpec[];
}): PlatformSpec {
  const [primary] = args.formats;

  return {
    ...args,
    formatName: primary.label,
    fields: primary.fields,
    groups: primary.groups,
    aspectRatios: primary.aspectRatios,
    defaultAspect: primary.defaultAspect,
    ctaOptions: primary.ctaOptions,
  };
}
