import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { createImage } from "../../ai/image";
import { describeError } from "../../ai/errors";
import { getImageChoices, imageProviderLabel } from "../../ai/provider";
import { ASPECT_RATIOS } from "../../platforms";
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
        "Text inside images renders badly past a few words. Specify at most one short line in quotes and describe the rest as non-legible texture.",
        "",
        "NOT every model returns the frame you ask for. The default composes for the aspect but always writes a square file; pick one whose `honoursDimensions` is true when the file's shape matters, such as a 9:16 story. The result says which you got.",
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

        const line = squareInstead
          ? `Rendered with ${image.model}, composed for ${aspect} but written as a square 1024x1024 file — this model cannot set dimensions. Re-render with a model whose honoursDimensions is true if the file has to be ${aspect}.`
          : `Rendered with ${image.model} at ${aspect}.`;

        return {
          content: [
            { type: "text", text: line },
            { type: "image", data: base64, mimeType: image.mediaType },
          ],
          // The data URL goes back too, so save_swipe can store the creative
          // without the host having to re-encode an image it just received.
          structuredContent: {
            model: image.model,
            mediaType: image.mediaType,
            requestedAspect: aspect,
            frameMatchesAspect: !squareInstead,
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
