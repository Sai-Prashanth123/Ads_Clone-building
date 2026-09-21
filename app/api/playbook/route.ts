import { isSwipeFileEnabled, SWIPE_FILE_SETUP_HINT } from "@/lib/db/client";
import { buildPlaybook } from "@/lib/analysis/playbook";
import { describeError } from "@/lib/ai/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!isSwipeFileEnabled()) {
    return Response.json({ error: SWIPE_FILE_SETUP_HINT }, { status: 503 });
  }

  try {
    return Response.json(await buildPlaybook());
  } catch (err) {
    return Response.json({ error: describeError(err) }, { status: 500 });
  }
}
