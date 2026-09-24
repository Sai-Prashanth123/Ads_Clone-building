import { fetchPost, manualPost } from "@/lib/x/fetch-post";
import { deconstruct } from "@/lib/ai/deconstruct";
import { generateVariations } from "@/lib/ai/variations";
import { encodeEvent, type CloneEvent } from "@/lib/ai/events";
import { brandProfileSchema, parseAngles } from "@/lib/ai/schemas";
import type { SourcePost } from "@/lib/x/types";
import { describeError } from "@/lib/ai/errors";
import { getPlatform } from "@/lib/platforms";
import { z } from "zod";

export const runtime = "nodejs";
export const maxDuration = 300;

const bodySchema = z.object({
  url: z.string().optional(),
  brand: brandProfileSchema.nullish(),
  targetPlatform: z.enum(["x", "linkedin", "meta", "google"]).optional(),
  angles: z.array(z.string()).max(8).optional(),
  manual: z
    .object({
      text: z.string().min(1),
      imageUrl: z.string().optional(),
      author: z.string().optional(),
    })
    .optional(),
});

export async function POST(req: Request) {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return Response.json({ error: "Malformed request body." }, { status: 400 });
  }

  if (!body.url && !body.manual) {
    return Response.json(
      { error: "Provide an X post URL, or paste the post manually." },
      { status: 400 },
    );
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: CloneEvent) => {
        if (closed) return;
        controller.enqueue(encodeEvent(event));
      };
      const close = () => {
        if (closed) return;
        closed = true;
        controller.close();
      };

      try {
        /* -- 1. Ingest ------------------------------------------------ */
        send({ type: "status", stage: "fetching", message: "Reading the post" });

        let post: SourcePost;
        if (body.manual) {
          post = manualPost(body.manual);
        } else {
          const result = await fetchPost(body.url as string);
          if (!result.ok) {
            send({ type: "error", message: result.message, recoverable: true });
            close();
            return;
          }
          post = result.post;
        }

        if (!post.text.trim()) {
          send({
            type: "error",
            message: "That post has no text to work from.",
            recoverable: true,
          });
          close();
          return;
        }

        /* -- 2. Deconstruct ------------------------------------------- */
        send({
          type: "status",
          stage: "reading",
          message: post.media.length
            ? "Deconstructing the framework and reading the creative"
            : "Deconstructing the framework",
        });

        const { dna, imageAnalysed } = await deconstruct(post, (message) =>
          send({ type: "status", stage: "reading", message }),
        );
        send({ type: "post", post, imageAnalysed });
        send({ type: "dna", dna });

        /* -- 3. Rewrite, then enforce both guards ---------------------- */
        const selectedAngles = parseAngles(body.angles);

        const variations = await generateVariations({
          post,
          dna,
          brand: body.brand ?? null,
          platform: getPlatform(body.targetPlatform),
          selectedAngles,
          onProgress: (p) => {
            if (p.phase === "drafting") {
              send({
                type: "status",
                stage: "writing",
                message: `Writing ${selectedAngles.length} angle${selectedAngles.length === 1 ? "" : "s"}`,
              });
            } else if (p.phase === "checking") {
              send({
                type: "status",
                stage: "checking",
                message: "Scoring against the original",
              });
            } else if (p.phase === "note") {
              // A provider blip or model switch, not a guard rejection.
              send({ type: "status", stage: "writing", message: p.message });
            } else {
              /* The retry is the longest single wait in the run, so the
               * message says which guard tripped and on what. Two different
               * failures reach here: lifted wording, and a shape that drifted
               * away from the source. */
              const reason = p.phrases.length
                ? `too close to the source — rewriting without “${p.phrases[0]}”`
                : p.drift?.length
                  ? `lost the original's shape — ${p.drift[0].replace(/.$/, "")}`
                  : "did not clear the guards — rewriting";

              send({
                type: "status",
                stage: "rewriting",
                message: `${p.failing} of ${selectedAngles.length} ${reason}`,
              });
            }
          },
        });
        send({ type: "variations", variations });
        send({ type: "done" });
      } catch (err) {
        send({ type: "error", message: describeError(err), recoverable: false });
      } finally {
        close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
