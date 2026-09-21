/**
 * Model IDs are plain "provider/model" strings resolved through the Vercel AI
 * Gateway — no provider SDKs, one key, and swapping a model is a string edit.
 *
 * These IDs were read from the live gateway catalog, not from memory.
 */

/** Vision + reasoning. Reads the original image and writes the new copy. */
export const ANALYSIS_MODEL = "anthropic/claude-opus-5";

/** Cheaper pass for the short, structural work. */
export const FAST_MODEL = "anthropic/claude-sonnet-5";

export type ImageModelId =
  | "openai/gpt-image-2.5-sunburst"
  | "bytedance/seedream-5.0-pro"
  | "google/gemini-3-pro-image";

export type ImageModelSpec = {
  id: ImageModelId;
  label: string;
  /** Shown under the picker so the choice is informed, not a guess. */
  note: string;
  /** Gateway "type": image models take a prompt; language models can take the
   *  source image too, which is what enables real style transfer. */
  kind: "image" | "language";
  supportsImageInput: boolean;
  approxCost: string;
};

export const IMAGE_MODELS: ImageModelSpec[] = [
  {
    id: "openai/gpt-image-2.5-sunburst",
    label: "gpt-image-2.5",
    note: "Sharpest text rendering. Pick this when the creative has a headline, chart labels or UI copy baked into it.",
    kind: "image",
    supportsImageInput: false,
    approxCost: "~$0.03",
  },
  {
    id: "bytedance/seedream-5.0-pro",
    label: "seedream-5.0",
    note: "Strong aesthetics at a flat rate. Best for lifestyle, product and abstract creative with little embedded text.",
    kind: "image",
    supportsImageInput: false,
    approxCost: "$0.035",
  },
  {
    id: "google/gemini-3-pro-image",
    label: "gemini-3-pro",
    note: "Reads the original image as input, so it varies the actual composition instead of working from a description.",
    kind: "language",
    supportsImageInput: true,
    approxCost: "~$0.13",
  },
];

export const DEFAULT_IMAGE_MODEL: ImageModelId = "openai/gpt-image-2.5-sunburst";

export function getImageModel(id: string): ImageModelSpec {
  return IMAGE_MODELS.find((m) => m.id === id) ?? IMAGE_MODELS[0];
}

export const ASPECT_RATIOS = [
  { id: "16:9", label: "16:9", note: "X timeline card" },
  { id: "1:1", label: "1:1", note: "Square feed" },
  { id: "4:5", label: "4:5", note: "Tall mobile" },
] as const;

export type AspectRatio = (typeof ASPECT_RATIOS)[number]["id"];
