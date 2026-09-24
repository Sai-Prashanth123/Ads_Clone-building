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
const PHOENIX = "@cf/leonardo/phoenix-1.0";
const LUCID = "@cf/leonardo/lucid-origin";

/**
 * Models that can put a legible word in the picture.
 *
 * Measured, not assumed. Given the same prompt asking for one short headline,
 * flux-1-schnell wrote "small brandes win" twice over at four steps and was
 * still misspelling at eight; Phoenix and Lucid Origin both rendered it
 * correctly, first try. For an ad creative that imitates a screenshot, that
 * difference is the whole job — a garbled headline destroys the one thing the
 * format was chosen for.
 *
 * They are Leonardo partner models with a per-image price, but on a free
 * Workers plan every model — partner ones included — draws on the same 10,000
 * daily neurons and fails the same way when it runs out. Billing separately
 * only starts on Workers Paid. So picking one is a quality decision today and
 * a spending decision the moment the account is upgraded, which is why the
 * free model stays the default either way.
 */
const TEXT_CAPABLE = new Set<string>([PHOENIX, LUCID]);

/** Whether this model can render a word you ask for and spell it correctly. */
export function rendersTextLegibly(model: string): boolean {
  return TEXT_CAPABLE.has(model);
}

export const CLOUDFLARE_IMAGE_MODELS = [
  {
    id: FLUX,
    label: "flux-1-schnell",
    note: "Free. Strongest composition and lighting, and it CANNOT spell — it garbles any word you ask it to render. Use it when the creative carries no text.",
    approxCost: "free · ~120/day",
    supportsImageInput: false,
    honoursDimensions: false,
    rendersText: false,
  },
  {
    id: PHOENIX,
    label: "phoenix-1.0",
    note: "Renders a short headline legibly and correctly, and honours exact dimensions. The one to pick when the creative imitates a screenshot, a post or anything with a word in it.",
    approxCost: "shares the free daily allowance; ~$0.02 each on Workers Paid",
    supportsImageInput: false,
    honoursDimensions: true,
    rendersText: true,
  },
  {
    id: LUCID,
    label: "lucid-origin",
    note: "Also spells correctly, and renders body copy as convincing illegible texture rather than attempting it — which is what a real screenshot looks like at a glance.",
    approxCost: "shares the free daily allowance; ~$0.02 each on Workers Paid",
    supportsImageInput: false,
    honoursDimensions: true,
    rendersText: true,
  },
  {
    id: SDXL,
    label: "sdxl",
    note: "Free, honours exact width and height, and takes a negative prompt. Weaker than the others at everything else, including text.",
    approxCost: "free · ~190/day",
    supportsImageInput: false,
    honoursDimensions: true,
    rendersText: false,
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
    /* Every model shares this, including the paid-tier ones — so "try the other
     * model" is the wrong advice and was being followed. Say what actually
     * changes the outcome. */
    throw new ActionableError(
      "Cloudflare's free daily allowance (10,000 neurons) is used up, and EVERY model here draws on it — switching models will not help until it resets in under 24 hours. Cloudflare's Workers Paid plan lifts the cap and bills the partner models per image.",
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
  const isLeonardo = args.model.includes("/leonardo/");

  const payload: Record<string, unknown> = isSdxl
    ? {
        prompt: args.prompt,
        ...(args.negativePrompt ? { negative_prompt: args.negativePrompt } : {}),
        ...aspectDimensions(args.aspectRatio as "16:9"),
        num_steps: 20,
      }
    : isLeonardo
      ? {
          prompt: [
            args.prompt,
            args.negativePrompt ? `Avoid: ${args.negativePrompt}` : "",
          ]
            .filter(Boolean)
            .join(" "),
          ...aspectDimensions(args.aspectRatio as "16:9"),
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
          /* Eight, not four.
           *
           * Four is the floor and it showed: soft edges, doubled headlines and
           * worse spelling than the same model manages with room to settle.
           * Eight roughly halves the daily allowance and is still ~120 images,
           * which is far more than a day's work. */
          steps: 8,
        };

  const res = await callWorkersAI(args.model, payload);
  const contentType = res.headers.get("content-type") ?? "";

  // SDXL and Phoenix answer with raw bytes; flux and Lucid answer with
  // base64 in JSON. The content type decides, not the model name.
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
