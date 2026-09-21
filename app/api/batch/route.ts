import { isSwipeFileEnabled, SWIPE_FILE_SETUP_HINT } from "@/lib/db/client";
import { createBatch, listBatches } from "@/lib/db/batches";
import { startBatch } from "@/lib/batch/runner";
import { describeError } from "@/lib/ai/errors";
import { brandProfileSchema } from "@/lib/ai/schemas";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_ITEMS = 100;

const createSchema = z.object({
  label: z.string().max(120).optional(),
  targetPlatform: z.enum(["x", "linkedin", "meta", "google"]).default("x"),
  brand: brandProfileSchema.nullish(),
  angles: z.array(z.string()).max(8).optional(),
  concurrency: z.number().int().min(1).max(6).optional(),
  /** One per line, or pasted bodies for platforms that cannot be scraped. */
  sources: z
    .array(z.object({ url: z.string().optional(), text: z.string().optional() }))
    .min(1)
    .max(MAX_ITEMS),
});

function disabled() {
  return Response.json({ error: SWIPE_FILE_SETUP_HINT }, { status: 503 });
}

export async function GET() {
  if (!isSwipeFileEnabled()) return disabled();
  try {
    return Response.json({ batches: await listBatches() });
  } catch (err) {
    return Response.json({ error: describeError(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!isSwipeFileEnabled()) return disabled();

  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(await req.json());
  } catch {
    return Response.json(
      { error: `Provide 1–${MAX_ITEMS} sources and a target platform.` },
      { status: 400 },
    );
  }

  const sources = body.sources.filter((s) => s.url?.trim() || s.text?.trim());
  if (sources.length === 0) {
    return Response.json({ error: "Every source was empty." }, { status: 400 });
  }

  try {
    const batch = await createBatch({
      label: body.label,
      targetPlatform: body.targetPlatform,
      brand: body.brand ?? null,
      angles: body.angles,
      sources,
    });

    // Return before the work starts. A fifty-item run cannot live inside one
    // response, and the tab should be free to close.
    startBatch(batch.id, body.concurrency);

    return Response.json({ id: batch.id, queued: sources.length }, { status: 202 });
  } catch (err) {
    return Response.json({ error: describeError(err) }, { status: 500 });
  }
}
