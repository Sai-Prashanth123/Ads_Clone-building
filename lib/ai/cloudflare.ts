import { ActionableError } from "./errors";
import { aspectDimensions } from "../platforms";

/**
 * Cloudflare Workers AI — image generation.
 *
 * Called over plain REST rather than through an AI SDK provider adapter: it is
 * a single endpoint returning base64, and implementing the full ImageModelV4
 * spec to wrap one POST would be more code with more to go wrong.
 *
 * Free tier is 10,000 neurons/day. flux-1-schnell costs 4.80 neurons per
 * 512x512 tile plus 9.60 per step, so a 4-step image is roughly 53 neurons —
 * about 190 a day at no cost.
 */

const BASE = "https://api.cloudflare.com/client/v4/accounts";

const FLUX = "@cf/black-forest-labs/flux-1-schnell";
const SDXL = "@cf/stabilityai/stable-diffusion-xl-base-1.0";

export const CLOUDFLARE_IMAGE_MODELS = [
  {
    id: FLUX,
    label: "flux-1-schnell",
    note: "Apache-2.0 FLUX, free tier. Strongest composition and lighting. Ignores exact dimensions, so the aspect is steered through the prompt.",
    approxCost: "free · ~190/day",
    supportsImageInput: false,
  },
  {
    id: SDXL,
    label: "sdxl",
    note: "Honours exact width and height and accepts a negative prompt. Reach for it when the frame shape matters more than the composition.",
    approxCost: "free · ~190/day",
    supportsImageInput: false,
  },
] as const;

export function cloudflareConfigured(): boolean {
  return Boolean(
    process.env.CLOUDFLARE_ACCOUNT_ID?.trim() &&
      process.env.CLOUDFLARE_API_TOKEN?.trim(),
  );
}


/**
 * flux-1-schnell takes only `prompt` and `steps` — passing width/height is a
 * hard 400. The frame shape therefore has to be described rather than set.
 */
function aspectPhrase(aspectRatio: string): string {
  switch (aspectRatio) {
    case "1:1":
      return "Square 1:1 composition.";
    case "4:5":
      return "Vertical 4:5 portrait composition.";
    case "9:16":
      // Stories and Reels. The UI covers the top and bottom of the frame, so
      // the subject has to be told to stay clear of it — cropping is not a
      // risk here, it is certain.
      return "Tall 9:16 vertical full-screen composition, subject centred with clear margins at the top and bottom.";
    case "1.91:1":
      // LinkedIn and Google both default to this, so omitting it silently
      // produced 16:9 creative for two of the four platforms.
      return "Wide 1.91:1 landscape composition, banner framing.";
    case "16:9":
    default:
      return "Wide 16:9 landscape composition, cinematic framing.";
  }
}

function credentials(): { account: string; token: string } {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim();

  if (!account || !token) {
    throw new ActionableError(
      "Cloudflare is not configured. Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in .env.local.",
    );
  }

  // cfk_ is a Global API Key, which uses a different auth scheme entirely and
  // would fail with an opaque 401. Say so plainly instead.
  if (token.startsWith("cfk_")) {
    throw new ActionableError(
      "CLOUDFLARE_API_TOKEN is a Global API Key (cfk_), not an API Token. Create one at My Profile → API Tokens → Create Custom Token with the Account → Workers AI → Read permission; it will start with cfut_.",
    );
  }

  return { account, token };
}

async function callWorkersAI(
  model: string,
  payload: Record<string, unknown>,
): Promise<Response> {
  const { account, token } = credentials();

  return fetch(`${BASE}/${account}/ai/run/${model}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120_000),
  });
}

function failed(status: number, detail?: string): never {
  if (status === 401 || status === 403) {
    throw new ActionableError(
      `Cloudflare rejected the credentials${detail ? ` (${detail})` : ""}. The token needs the Account → Workers AI → Read permission, and CLOUDFLARE_ACCOUNT_ID must be the account that owns it.`,
    );
  }
  if (status === 429) {
    throw new ActionableError(
      "Cloudflare's free daily allowance (10,000 neurons) is used up. It resets every 24 hours.",
    );
  }
  throw new Error(
    `Cloudflare Workers AI failed${detail ? `: ${detail}` : ` (HTTP ${status})`}.`,
  );
}

export async function generateCloudflareImage(args: {
  prompt: string;
  negativePrompt?: string;
  model: string;
  aspectRatio: string;
}): Promise<{ dataUrl: string; mediaType: string; model: string }> {
  const isSdxl = args.model.includes("stable-diffusion");

  const payload: Record<string, unknown> = isSdxl
    ? {
        prompt: args.prompt,
        ...(args.negativePrompt ? { negative_prompt: args.negativePrompt } : {}),
        ...aspectDimensions(args.aspectRatio as "16:9"),
        num_steps: 20,
      }
    : {
        // flux: aspect is described, and negatives are folded into the prompt
        // because the model accepts neither parameter.
        prompt: [
          args.prompt,
          aspectPhrase(args.aspectRatio),
          args.negativePrompt ? `Avoid: ${args.negativePrompt}` : "",
        ]
          .filter(Boolean)
          .join(" "),
        steps: 4,
      };

  const res = await callWorkersAI(args.model, payload);
  const contentType = res.headers.get("content-type") ?? "";

  // SDXL answers with raw PNG bytes; flux answers with base64 in JSON.
  if (!contentType.includes("application/json")) {
    if (!res.ok) {
      failed(res.status, (await res.text().catch(() => "")).slice(0, 160));
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    const mediaType = contentType.split(";")[0] || "image/png";
    return {
      dataUrl: `data:${mediaType};base64,${bytes.toString("base64")}`,
      mediaType,
      model: args.model,
    };
  }

  const body = (await res.json().catch(() => null)) as {
    success?: boolean;
    errors?: { code?: number; message?: string }[];
    result?: { image?: string };
  } | null;

  if (!res.ok || body?.success === false) {
    failed(
      res.status,
      body?.errors?.map((e) => e.message).filter(Boolean).join("; "),
    );
  }

  const b64 = body?.result?.image;
  if (!b64) {
    throw new Error(
      "Cloudflare returned no image for this prompt. Try the other model in the picker.",
    );
  }

  return {
    dataUrl: `data:image/jpeg;base64,${b64}`,
    mediaType: "image/jpeg",
    model: args.model,
  };
}
