import { generateImage, generateText } from "ai";
import {
  detectImageProvider,
  getImageChoices,
  getImageLanguageModel,
  getImageModel,
  type ImageChoice,
} from "./provider";
import { generateCloudflareImage } from "./cloudflare";
import type { AspectRatio } from "../platforms";

export type GeneratedImage = {
  /** data: URL, ready for <img src> and for download. */
  dataUrl: string;
  mediaType: string;
  model: string;
};

function buildPrompt(prompt: string, negatives?: string): string {
  const trimmed = prompt.trim();
  if (!negatives?.trim()) return trimmed;
  return `${trimmed}\n\nAvoid: ${negatives.trim()}`;
}

function resolveChoice(requested?: string): ImageChoice {
  const choices = getImageChoices();
  if (choices.length === 0) {
    throw new Error(
      "The configured provider cannot generate images. Add GOOGLE_GENERATIVE_AI_API_KEY (free tier) or OPENAI_API_KEY.",
    );
  }
  return choices.find((c) => c.id === requested) ?? choices[0];
}

async function fetchSourceImage(
  url: string,
): Promise<{ data: Uint8Array; mediaType: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AdCloneStudio/1.0)" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const data = new Uint8Array(await res.arrayBuffer());
    const mediaType = res.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
    return mediaType.startsWith("image/") ? { data, mediaType } : null;
  } catch {
    return null;
  }
}

export async function createImage(args: {
  prompt: string;
  negatives?: string;
  model?: string;
  aspectRatio?: AspectRatio;
  /** Only used by models that accept image input. */
  referenceImageUrl?: string;
}): Promise<GeneratedImage> {
  const choice = resolveChoice(args.model);
  const prompt = buildPrompt(args.prompt, args.negatives);
  const aspectRatio = args.aspectRatio ?? "16:9";

  // Cloudflare speaks plain REST rather than the AI SDK provider interface.
  if (detectImageProvider() === "cloudflare") {
    return generateCloudflareImage({
      prompt: args.prompt.trim(),
      negativePrompt: args.negatives?.trim() || undefined,
      model: choice.id,
      aspectRatio,
    });
  }

  // Models that accept image input go through generateText so the original
  // creative can be attached — that is the whole reason to pick one.
  if (choice.supportsImageInput) {
    const reference = args.referenceImageUrl
      ? await fetchSourceImage(args.referenceImageUrl)
      : null;

    const result = await generateText({
      model: getImageLanguageModel(choice.id),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: reference
                ? `Here is an existing ad creative for reference. Produce a NEW image that keeps its composition and emotional read, but is unmistakably different in palette, subject and style.\n\n${prompt}`
                : prompt,
            },
            ...(reference
              ? [
                  {
                    type: "file" as const,
                    mediaType: reference.mediaType,
                    data: reference.data,
                  },
                ]
              : []),
          ],
        },
      ],
    });

    const file = result.files?.find((f) => f.mediaType?.startsWith("image/"));
    if (!file) {
      throw new Error(
        `${choice.label} returned no image for this prompt. Try another model in the picker.`,
      );
    }

    return {
      dataUrl: `data:${file.mediaType};base64,${file.base64}`,
      mediaType: file.mediaType,
      model: choice.id,
    };
  }

  const { image } = await generateImage({
    model: getImageModel(choice.id),
    prompt,
    aspectRatio,
  });

  const mediaType = image.mediaType ?? "image/png";
  return {
    dataUrl: `data:${mediaType};base64,${image.base64}`,
    mediaType,
    model: choice.id,
  };
}
