import { isSwipeFileEnabled, SWIPE_FILE_SETUP_HINT } from "@/lib/db/client";
import { getBatch, requeueFailed } from "@/lib/db/batches";
import { isBatchRunning, startBatch } from "@/lib/batch/runner";
import { describeError } from "@/lib/ai/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Next 16: route params are async.
type Ctx = { params: Promise<{ id: string }> };

function disabled() {
  return Response.json({ error: SWIPE_FILE_SETUP_HINT }, { status: 503 });
}

export async function GET(_req: Request, ctx: Ctx) {
  if (!isSwipeFileEnabled()) return disabled();

  const { id } = await ctx.params;

  try {
    const progress = await getBatch(id);
    if (!progress) {
      return Response.json({ error: "No such batch." }, { status: 404 });
    }
    return Response.json({ ...progress, running: isBatchRunning(id) });
  } catch (err) {
    return Response.json({ error: describeError(err) }, { status: 500 });
  }
}

/**
 * Retry the failures, or resume a batch whose worker died — which on Render's
 * free plan happens whenever the service spins down mid-run.
 */
export async function POST(req: Request, ctx: Ctx) {
  if (!isSwipeFileEnabled()) return disabled();

  const { id } = await ctx.params;
  const action = new URL(req.url).searchParams.get("action") ?? "resume";

  try {
    const requeued = action === "retry-failed" ? await requeueFailed(id) : 0;
    startBatch(id);
    return Response.json({ ok: true, requeued, running: true });
  } catch (err) {
    return Response.json({ error: describeError(err) }, { status: 500 });
  }
}
