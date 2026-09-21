import { isSwipeFileEnabled } from "@/lib/db/client";
import { deleteSwipe, listSwipes, saveSwipe } from "@/lib/db/swipes";
import { describeError } from "@/lib/ai/errors";
import { adDnaSchema } from "@/lib/ai/schemas";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const saveSchema = z.object({
  post: z.object({
    id: z.string(),
    url: z.string(),
    author: z.object({
      name: z.string(),
      handle: z.string(),
      avatar: z.string().optional(),
    }),
    text: z.string().min(1),
    media: z.array(
      z.object({
        type: z.enum(["photo", "video"]),
        url: z.string(),
        width: z.number().optional(),
        height: z.number().optional(),
      }),
    ),
    engagement: z.record(z.string(), z.number().optional()),
    createdAt: z.string().optional(),
    isLongForm: z.boolean().optional(),
    truncated: z.boolean().optional(),
    source: z.enum(["fxtwitter", "syndication", "twitterapi", "manual"]),
  }),
  dna: adDnaSchema,
  variations: z.array(z.looseObject({ angle: z.string(), text: z.string() })),
  images: z.record(z.string(), z.string()).optional(),
});

function disabled() {
  return Response.json(
    {
      error:
        "The swipe file is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local.",
    },
    { status: 503 },
  );
}

export async function GET(req: Request) {
  if (!isSwipeFileEnabled()) return disabled();

  const url = new URL(req.url);
  try {
    const swipes = await listSwipes({
      search: url.searchParams.get("q") ?? undefined,
      hookType: url.searchParams.get("hook") ?? undefined,
      limit: Number(url.searchParams.get("limit")) || 50,
    });
    return Response.json({ swipes });
  } catch (err) {
    return Response.json({ error: describeError(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!isSwipeFileEnabled()) return disabled();

  let body: z.infer<typeof saveSchema>;
  try {
    body = saveSchema.parse(await req.json());
  } catch {
    return Response.json({ error: "Malformed request body." }, { status: 400 });
  }

  try {
    const result = await saveSwipe({
      post: body.post as Parameters<typeof saveSwipe>[0]["post"],
      dna: body.dna,
      variations: body.variations as Parameters<
        typeof saveSwipe
      >[0]["variations"],
      images: body.images,
    });
    return Response.json(result, { status: 201 });
  } catch (err) {
    return Response.json({ error: describeError(err) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  if (!isSwipeFileEnabled()) return disabled();

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Missing id." }, { status: 400 });

  try {
    await deleteSwipe(id);
    return new Response(null, { status: 204 });
  } catch (err) {
    return Response.json({ error: describeError(err) }, { status: 500 });
  }
}
