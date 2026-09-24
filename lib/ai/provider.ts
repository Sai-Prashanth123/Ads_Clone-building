import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { ImageModel, LanguageModel } from "ai";
import { CLOUDFLARE_IMAGE_MODELS, cloudflareConfigured } from "./cloudflare";

/**
 * The studio is not tied to one billing account.
 *
 * Whichever key is present wins, in the order below. The Vercel AI Gateway is
 * preferred when configured because one key reaches every model; the direct
 * providers exist so a blocked or unfunded gateway doesn't take the app down
 * with it.
 *
 * Google leads the direct providers because AI Studio's free tier is the only
 * one that covers BOTH halves of this pipeline — vision for reading the source
 * creative, and image generation for producing the new one.
 */

export type ProviderId = "gateway" | "google" | "anthropic" | "openai";

export type ProviderInfo = {
  id: ProviderId;
  label: string;
  envVar: string;
  /** False when the provider can't make images — the UI says so plainly. */
  canGenerateImages: boolean;
  /** False when the provider can't read the source creative. */
  canReadImages: boolean;
  signupUrl: string;
};

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  gateway: {
    id: "gateway",
    label: "Vercel AI Gateway",
    envVar: "AI_GATEWAY_API_KEY",
    canGenerateImages: true,
    canReadImages: true,
    signupUrl: "https://vercel.com/ai-gateway",
  },
  google: {
    id: "google",
    label: "Google AI Studio",
    envVar: "GOOGLE_GENERATIVE_AI_API_KEY",
    canGenerateImages: true,
    canReadImages: true,
    signupUrl: "https://aistudio.google.com/apikey",
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    envVar: "ANTHROPIC_API_KEY",
    canGenerateImages: false,
    canReadImages: true,
    signupUrl: "https://console.anthropic.com/settings/keys",
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    envVar: "OPENAI_API_KEY",
    canGenerateImages: true,
    canReadImages: true,
    signupUrl: "https://platform.openai.com/api-keys",
  },
};

const ORDER: ProviderId[] = ["gateway", "google", "anthropic", "openai"];

function keyFor(id: ProviderId): string | undefined {
  const value = process.env[PROVIDERS[id].envVar];
  return value && value.trim() ? value.trim() : undefined;
}

export function detectProvider(): ProviderId | null {
  return ORDER.find((id) => keyFor(id)) ?? null;
}

export function availableProviders(): ProviderId[] {
  return ORDER.filter((id) => keyFor(id));
}

export class NoProviderError extends Error {
  constructor() {
    super(
      "No model provider is configured. Set one of these in .env.local: " +
        ORDER.map((id) => PROVIDERS[id].envVar).join(", ") +
        ". Google AI Studio (GOOGLE_GENERATIVE_AI_API_KEY) has a free tier that covers both text and images.",
    );
    this.name = "NoProviderError";
  }
}

/* ------------------------------------------------------------------ *
 * Model selection per provider.
 * ------------------------------------------------------------------ */

/**
 * Ordered preference, best first.
 *
 * More than one per provider because free-tier quota is metered PER MODEL —
 * Google allows 20 requests/minute on each. When the first is rate-limited the
 * next still has budget, so a chain of three triples the effective ceiling
 * instead of failing the run.
 */
const ANALYSIS_MODELS: Record<ProviderId, string[]> = {
  gateway: ["anthropic/claude-opus-5", "anthropic/claude-sonnet-5"],
  google: ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3-flash-preview"],
  anthropic: ["claude-opus-5", "claude-sonnet-5"],
  openai: ["gpt-5.6-sol"],
};

export type NamedModel = { id: string; model: LanguageModel };

function buildModel(provider: ProviderId, modelId: string): LanguageModel {
  switch (provider) {
    case "gateway":
      // Plain "provider/model" strings resolve through the gateway.
      return modelId;
    case "google":
      return createGoogleGenerativeAI({ apiKey: keyFor("google") })(modelId);
    case "anthropic":
      return createAnthropic({ apiKey: keyFor("anthropic") })(modelId);
    case "openai":
      return createOpenAI({ apiKey: keyFor("openai") })(modelId);
  }
}

/** The full fallback chain, in order. */
export function getAnalysisModels(): NamedModel[] {
  const id = detectProvider();
  if (!id) throw new NoProviderError();

  return ANALYSIS_MODELS[id].map((modelId) => ({
    id: modelId,
    model: buildModel(id, modelId),
  }));
}

export function getAnalysisModel(): LanguageModel {
  return getAnalysisModels()[0].model;
}

/* ------------------------------------------------------------------ *
 * Image models, expressed per provider so the picker only ever offers
 * what this deployment can actually render.
 * ------------------------------------------------------------------ */

export type ImageChoice = {
  /** Stable id used by the client. */
  id: string;
  label: string;
  note: string;
  approxCost: string;
  /** Can take the original creative as input for true style transfer. */
  supportsImageInput: boolean;
  /**
   * Whether the model returns the frame it was asked for.
   *
   * flux-1-schnell composes for an aspect but always writes 1024x1024 — width
   * and height are a hard 400 on that endpoint. Fine for a feed image, wrong
   * for a 9:16 story, and invisible unless something says so. Undefined means
   * unknown, which is treated as honouring it: the hosted providers do.
   */
  honoursDimensions?: boolean;
  /**
   * Whether a word in the prompt comes back spelled correctly.
   *
   * The free models cannot do it, and an ad creative that imitates a screenshot
   * lives or dies on one legible line. Measured rather than assumed.
   */
  rendersText?: boolean;
};

const IMAGE_CHOICES: Record<ProviderId, ImageChoice[]> = {
  gateway: [
    {
      id: "openai/gpt-image-2.5-sunburst",
      label: "gpt-image-2.5",
      note: "Sharpest text rendering. Pick this when the creative has a headline, chart labels or UI copy baked in.",
      approxCost: "~$0.03",
      supportsImageInput: false,
    },
    {
      id: "bytedance/seedream-5.0-pro",
      label: "seedream-5.0",
      note: "Strong aesthetics at a flat rate. Best for lifestyle, product and abstract creative.",
      approxCost: "$0.035",
      supportsImageInput: false,
    },
    {
      id: "google/gemini-3-pro-image",
      label: "gemini-3-pro",
      note: "Reads the original creative as input, so it varies the real composition rather than a description of it.",
      approxCost: "~$0.13",
      supportsImageInput: true,
    },
  ],
  google: [
    {
      id: "gemini-3-pro-image",
      label: "gemini-3-pro-image",
      note: "Reads the original creative as input, so it varies the real composition rather than a description of it.",
      approxCost: "free tier",
      supportsImageInput: true,
    },
    {
      id: "gemini-3.1-flash-image",
      label: "gemini-3.1-flash-image",
      note: "Faster and cheaper. Good for iterating on a direction before committing.",
      approxCost: "free tier",
      supportsImageInput: true,
    },
  ],
  anthropic: [],
  openai: [
    {
      id: "gpt-image-2.5-sunburst",
      label: "gpt-image-2.5",
      note: "Sharpest text rendering. Pick this when the creative has a headline, chart labels or UI copy baked in.",
      approxCost: "~$0.03",
      supportsImageInput: false,
    },
    {
      id: "gpt-image-1.5",
      label: "gpt-image-1.5",
      note: "Cheaper previous generation. Fine for simple, text-free creative.",
      approxCost: "~$0.01",
      supportsImageInput: false,
    },
  ],
};

/**
 * The provider that renders images need not be the one that does the thinking.
 * Google's free tier, for instance, covers vision but gives image models zero
 * quota — so analysis runs on Google while Cloudflare renders. Keeping these
 * separate is what makes that combination possible.
 */
export type ImageProviderId = ProviderId | "cloudflare";

export function detectImageProvider(): ImageProviderId | null {
  // Cloudflare leads when configured: it is the only one here with a free tier
  // that actually serves images.
  if (cloudflareConfigured()) return "cloudflare";

  const id = detectProvider();
  if (!id) return null;
  return IMAGE_CHOICES[id].length > 0 ? id : null;
}

export function getImageChoices(): ImageChoice[] {
  const id = detectImageProvider();
  if (!id) return [];
  if (id === "cloudflare") {
    return CLOUDFLARE_IMAGE_MODELS.map((m) => ({ ...m }));
  }
  return IMAGE_CHOICES[id];
}

export function imageProviderLabel(): string | null {
  const id = detectImageProvider();
  if (!id) return null;
  return id === "cloudflare" ? "Cloudflare Workers AI" : PROVIDERS[id].label;
}

export function getImageModel(modelId: string): ImageModel {
  const id = detectProvider();
  if (!id) throw new NoProviderError();

  switch (id) {
    case "gateway":
      return modelId;
    case "google":
      return createGoogleGenerativeAI({ apiKey: keyFor("google") }).image(modelId);
    case "openai":
      return createOpenAI({ apiKey: keyFor("openai") }).image(modelId);
    case "anthropic":
      throw new Error(
        "Anthropic has no image model. Add GOOGLE_GENERATIVE_AI_API_KEY (free tier) or OPENAI_API_KEY to generate creative.",
      );
  }
}

/**
 * Image-capable *language* models produce images through generateText with the
 * source creative attached, which is what makes real style transfer possible.
 */
export function getImageLanguageModel(modelId: string): LanguageModel {
  const id = detectProvider();
  if (!id) throw new NoProviderError();

  switch (id) {
    case "gateway":
      return modelId;
    case "google":
      return createGoogleGenerativeAI({ apiKey: keyFor("google") })(modelId);
    default:
      throw new Error(`${PROVIDERS[id].label} has no image-input model.`);
  }
}

export function describeSetup(): {
  provider: ProviderInfo | null;
  imageProvider: string | null;
  canGenerateImages: boolean;
  imageChoices: ImageChoice[];
} {
  const id = detectProvider();
  const choices = getImageChoices();
  return {
    provider: id ? PROVIDERS[id] : null,
    imageProvider: imageProviderLabel(),
    // Reported from what can actually be rendered, not a static per-provider
    // flag — claiming an ability the deployment lacks is worse than silence.
    canGenerateImages: choices.length > 0,
    imageChoices: choices,
  };
}
