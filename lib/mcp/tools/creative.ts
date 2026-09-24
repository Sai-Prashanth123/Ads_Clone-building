import { z } from "zod";
import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { createImage } from "../../ai/image";
import { describeError } from "../../ai/errors";
import { getImageChoices, imageProviderLabel } from "../../ai/provider";
import { ASPECT_RATIOS } from "../../platforms";
import { isSwipeFileEnabled } from "../../db/client";
import { stageCreative } from "../../db/swipes";
import { fail, ok } from "../result";

/**
 * Image generation stays on the server.
 *
 * Not for want of intelligence — the host writes a far better prompt than the
 * old pipeline did — but because rendering needs a funded image endpoint, and
 * Cloudflare Workers AI gives roughly 190 free FLUX images a day. Claude cannot
 * produce images at all, and neither host can emit one through a tool call.
 */
type RenderedCreative = {
  label: string;
  line: string;
  base64?: string;
  mediaType?: string;
  imageUrl: string | null;
  model: string | null;
  frameMatchesAspect: boolean;
  textWillBeGarbled: boolean;
  error?: string;
};

/**
 * One creative, rendered and described.
 *
 * Shared by the single render and the batch so the two cannot drift: the same
 * two traps are reported the same way, and the same staged URL comes back for
 * save_swipe. A failure is returned rather than thrown, because in a batch one
 * exhausted quota should cost the remaining pictures and not the ones already
 * made.
 */
async function renderOne(args: {
  label?: string;
  prompt: string;
  negatives?: string;
  model?: string;
  aspect: string;
  referenceImageUrl?: string;
}): Promise<RenderedCreative> {
  const prefix = args.label ? `${args.label} — ` : "";

  try {
    const image = await createImage({
      prompt: args.prompt,
      negatives: args.negatives,
      model: args.model,
      aspectRatio: args.aspect as Parameters<typeof createImage>[0]["aspectRatio"],
      referenceImageUrl: args.referenceImageUrl,
    });

    const choice = getImageChoices().find((c) => c.id === image.model);

    /* Say when the frame is not the one that was asked for.
     *
     * The default model composes for the aspect and returns a square file
     * regardless. Fine for a feed image, wrong for a story, and invisible
     * unless the result mentions it. */
    const squareInstead =
      choice?.honoursDimensions === false && args.aspect !== "1:1";

    /* Did the prompt ask for a word the model cannot spell?
     *
     * The free models garble any text they render — measured: "small brands
     * win" came back as "small brandes win", twice over. A creative imitating
     * a screenshot lives on that one line. */
    const wantsText = /"[^"]{2,60}"|'[^']{2,60}'/.test(args.prompt);
    const cannotSpell = wantsText && choice?.rendersText === false;

    const staged = isSwipeFileEnabled()
      ? await stageCreative(image.dataUrl)
      : null;

    const frame = squareInstead
      ? `${prefix}rendered with ${image.model}, composed for ${args.aspect} but written as a square 1024x1024 file — this model cannot set dimensions.`
      : `${prefix}rendered with ${image.model} at ${args.aspect}.`;

    const spelling = cannotSpell
      ? ` Your prompt asks for text and ${choice?.label} cannot spell it — expect it garbled. Re-render with a model whose rendersText is true if the words matter.`
      : "";

    const keep = staged
      ? ` Pass imageUrl "${staged.url}" to save_swipe to keep it.`
      : " No swipe file is configured, so it is not stored anywhere.";

    return {
      label: args.label ?? "",
      line: `${frame}${spelling}${keep}`,
      base64: image.dataUrl.split(",")[1] ?? "",
      mediaType: image.mediaType,
      imageUrl: staged?.url ?? null,
      model: image.model,
      frameMatchesAspect: !squareInstead,
      textWillBeGarbled: cannotSpell,
    };
  } catch (err) {
    const message = describeError(err, imageProviderLabel());
    return {
      label: args.label ?? "",
      line: `${prefix}not rendered: ${message}`,
      imageUrl: null,
      model: null,
      frameMatchesAspect: false,
      textWillBeGarbled: false,
      error: message,
    };
  }
}


/** One rendered creative as a tool result: the note, then the picture. */
function renderResult(r: RenderedCreative): CallToolResult {
  if (r.error) return fail(r.line);

  return {
    content: [
      { type: "text", text: r.line },
      { type: "image", data: r.base64 ?? "", mimeType: r.mediaType ?? "image/png" },
    ],
    structuredContent: {
      model: r.model,
      mediaType: r.mediaType,
      imageUrl: r.imageUrl,
      frameMatchesAspect: r.frameMatchesAspect,
      textWillBeGarbled: r.textWillBeGarbled,
    },
  };
}

export function registerCreativeTools(server: McpServer): void {
  server.registerTool(
    "generate_image",
    {
      title: "Render an ad creative",
      description: [
        "Generate the creative from a text prompt and return the image.",
        "",
        "Write the prompt so it inherits the original visual's JOB, not just its mood. If the source worked because it looked like an organic screenshot, a meme or a real dashboard, that FORMAT is the mechanism — clone it as a different screenshot, not as a polished illustration. Change the palette, subject and setting; keep the compositional relationship.",
        "",
        "ONE line of text, and one only. Every model here degrades sharply as text elements are added: asked for a headline plus a vote count plus a timestamp, the headline itself comes back misspelt. Asked for a single line and nothing else, it is rendered correctly. Name the one line in quotes and describe everything else — body copy, usernames, counts — as unreadable texture with no letterforms.",
        "",
        "Expect to re-roll. These models are stochastic and a second attempt at the same prompt often fixes a garbled word, so look at what came back rather than assuming it worked.",
        "",
        "AND NOT EVERY MODEL CAN SPELL. The free ones garble any word you ask them to render — the same prompt came back as \"small brandes win\", twice over — which ruins a creative that imitates a screenshot or a post, because the format IS the mechanism and a misspelt headline gives it away. If your prompt contains a line of text, pick a model whose `rendersText` is true. On a free Workers plan they draw on the same daily allowance as everything else; on Workers Paid they bill per image. The result says plainly when you have asked the wrong model for text.",
        "",
        "NOT every model returns the frame you ask for. The default composes for the aspect but always writes a square file; pick one whose `honoursDimensions` is true when the file's shape matters, such as a 9:16 story. The result says which you got.",
        "",
        "The result carries an `imageUrl`. Pass that to save_swipe — it is how a creative gets attached to a saved run, and it is short enough to carry through a conversation. The raw bytes come back as an image block for you to LOOK at, not to copy.",
        "",
        "Call list_image_models to see what this deployment can render and which aspect ratios apply.",
      ].join("\n"),
      inputSchema: {
        prompt: z.string().min(4).max(4000),
        negatives: z
          .string()
          .max(1000)
          .optional()
          .describe("What to avoid, comma separated."),
        model: z.string().optional().describe("From list_image_models."),
        aspectRatio: z.enum(ASPECT_RATIOS).optional(),
        referenceImageUrl: z
          .string()
          .optional()
          .describe("Only used by models that accept image input."),
      },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    async (args) =>
      renderResult(
        await renderOne({
          prompt: args.prompt,
          negatives: args.negatives,
          model: args.model,
          aspect: args.aspectRatio ?? "16:9",
          referenceImageUrl: args.referenceImageUrl,
        }),
      ),
  );

  server.registerTool(
    "list_image_models",
    {
      title: "List available image models",
      description:
        "Which image models this deployment can actually render with, and their trade-offs. Empty when no image provider is configured — in that case hand the operator the prompt instead of promising a picture.",
      inputSchema: {},
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => {
      const choices = getImageChoices();
      return ok({
        provider: imageProviderLabel(),
        canGenerate: choices.length > 0,
        models: choices,
      });
    },
  );

  server.registerTool(
    "generate_images",
    {
      title: "Render every variation's creative in one call",
      description: [
        "Render a creative for each variation and return them all as images, in order, labelled by angle.",
        "",
        "Use this rather than calling generate_image once per angle. A set of variations is meant to be compared, and comparing them means seeing them together — one call puts every creative in the reply instead of scattering them through the conversation or, worse, behind a link.",
        "",
        "Each result carries an `imageUrl` to pass to save_swipe under the matching angle.",
        "",
        "The same two traps as the single render apply to every entry: a model that cannot set dimensions writes a square whatever you ask for, and a model that cannot spell garbles any word in the prompt. Both are reported per creative rather than for the batch.",
        "",
        "Cards of one carousel must look like one set — same palette, same render style, same framing logic — so say that in every prompt rather than hoping.",
        "",
        "A render that fails does not stop the others: it comes back with its reason, so a quota that runs out mid-batch costs the remaining pictures and not the ones already made.",
      ].join("\n"),
      inputSchema: {
        creatives: z
          .array(
            z.object({
              label: z
                .string()
                .min(1)
                .max(80)
                .describe("The angle, or the card's position. Shown above its image."),
              prompt: z.string().min(4).max(4000),
              negatives: z.string().max(1000).optional(),
            }),
          )
          .min(1)
          .max(6)
          .describe("One entry per variation, in the order you want them shown."),
        model: z.string().optional().describe("From list_image_models."),
        aspectRatio: z.enum(ASPECT_RATIOS).optional(),
      },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    async ({ creatives, model, aspectRatio }) => {
      const aspect = aspectRatio ?? "16:9";

      /* Rendered in sequence on purpose.
       *
       * The provider bills a shared daily allowance and answers 429 when it is
       * gone. Firing six at once turns one exhausted quota into six failures
       * and six wasted waits; in sequence, the ones before it still land. */
      const results: RenderedCreative[] = [];

      for (const c of creatives) {
        results.push(
          await renderOne({
            label: c.label,
            prompt: c.prompt,
            negatives: c.negatives,
            model,
            aspect,
          }),
        );
      }

      const content: CallToolResult["content"] = [];

      for (const r of results) {
        content.push({ type: "text", text: r.line });
        if (r.base64 && r.mediaType) {
          content.push({
            type: "image",
            data: r.base64,
            mimeType: r.mediaType,
          });
        }
      }

      const rendered = results.filter((r) => r.base64).length;

      content.unshift({
        type: "text",
        text:
          rendered === results.length
            ? `${rendered} creative${rendered === 1 ? "" : "s"}, in order.`
            : `${rendered} of ${results.length} rendered. The rest say why below.`,
      });

      return {
        content,
        structuredContent: {
          rendered,
          failed: results.length - rendered,
          creatives: results.map((r) => ({
            label: r.label,
            imageUrl: r.imageUrl,
            model: r.model,
            frameMatchesAspect: r.frameMatchesAspect,
            textWillBeGarbled: r.textWillBeGarbled,
            error: r.error,
          })),
        },
      };
    },
  );
}
