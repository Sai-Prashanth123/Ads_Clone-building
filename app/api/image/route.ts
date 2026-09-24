import { createImage } from "@/lib/ai/image";
import { describeError } from "@/lib/ai/errors";
import { imageProviderLabel } from "@/lib/ai/provider";
import { ASPECT_RATIOS } from "@/lib/platforms";
import { z } from "zod";

export const runtime = "nodejs";
export const maxDuration = 300;

const bodySchema = z.object({
  prompt: z.string().min(4).max(4000),
  negatives: z.string().max(1000).optional(),
  model: z.string().optional(),
  aspectRatio: z.enum(ASPECT_RATIOS).optional(),
  referenceImageUrl: z.string().url().optional(),
});

export async function POST(req: Request) {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return Response.json({ error: "Malformed request body." }, { status: 400 });
  }

  try {
    const image = await createImage(body);
    return Response.json(image);
  } catch (err) {
    return Response.json(
      { error: describeError(err, imageProviderLabel()) },
      { status: 502 },
    );
  }
}
