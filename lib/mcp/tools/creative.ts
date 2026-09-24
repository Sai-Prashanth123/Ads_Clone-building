import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
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
        "AND NOT EVERY MODEL CAN SPELL. The free ones garble any word you ask them to render — the same prompt came back as \"small brandes win\", twice over — which ruins a creative that imitates a screenshot or a post, because the format IS the mechanism and a misspelt headline gives it away. If your prompt contains a line of text, pick a model whose `rendersText` is true. Those bill per image rather than against the free allowance, so it is a real choice; the result says plainly when you have asked the wrong model for text.",
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
    async (args) => {
      try {
        const image = await createImage(args);
        const base64 = image.dataUrl.split(",")[1] ?? "";

        const aspect = args.aspectRatio ?? "16:9";
        const choice = getImageChoices().find((c) => c.id === image.model);

        /* Say when the frame is not the one that was asked for.
         *
         * The default model composes for the aspect and returns a square file
         * regardless. That is fine for a feed image and wrong for a story, and
         * the difference is invisible unless the result mentions it. */
        const squareInstead =
          choice?.honoursDimensions === false && aspect !== "1:1";

        /* Did the prompt ask for a word the model cannot spell?
         *
         * The free models garble any text they are asked to render — measured:
         * "small brands win" came back as "small brandes win", twice over. An
         * ad creative imitating a screenshot lives on that one line, so a
         * silently garbled headline wastes the render and the idea with it. */
        const wantsText = /"[^"]{2,60}"|'[^']{2,60}'/.test(args.prompt);
        const cannotSpell = wantsText && choice?.rendersText === false;

        /* Park the creative somewhere the caller can point at.
         *
         * Handing back base64 in structuredContent showed the model a picture
         * it had no way to reference — most clients surface only the content
         * blocks — so an image could never be attached to a save over MCP.
         * A URL survives the round trip; a megabyte of base64 does not. */
        const staged = isSwipeFileEnabled()
          ? await stageCreative(image.dataUrl)
          : null;

        const line = squareInstead
          ? `Rendered with ${image.model}, composed for ${aspect} but written as a square 1024x1024 file — this model cannot set dimensions. Re-render with a model whose honoursDimensions is true if the file has to be ${aspect}.`
          : `Rendered with ${image.model} at ${aspect}.`;

        const spelling = cannotSpell
          ? ` Your prompt asks for text in the image and ${choice?.label} cannot spell — expect it garbled. Re-render with a model whose rendersText is true if the words matter.`
          : "";

        const note = staged
          ? `${line}${spelling} Pass imageUrl "${staged.url}" to save_swipe to keep it.`
          : `${line}${spelling} No swipe file is configured, so it is not stored anywhere.`;

        return {
          content: [
            { type: "text", text: note },
            { type: "image", data: base64, mimeType: image.mediaType },
          ],
          // The data URL goes back too, so save_swipe can store the creative
          // without the host having to re-encode an image it just received.
          structuredContent: {
            model: image.model,
            mediaType: image.mediaType,
            requestedAspect: aspect,
            frameMatchesAspect: !squareInstead,
            imageUrl: staged?.url ?? null,
            textWillBeGarbled: cannotSpell,
            dataUrl: image.dataUrl,
          },
        };
      } catch (err) {
        return fail(describeError(err, imageProviderLabel()));
      }
    },
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
}
