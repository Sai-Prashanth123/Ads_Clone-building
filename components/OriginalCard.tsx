"use client";

import { Cell, Chip, Lattice, Panel } from "./primitives";
import { engagementRate, type SourcePost } from "@/lib/x/types";

function compact(n?: number): string {
  if (n == null) return "—";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

const SOURCE_NOTE: Record<SourcePost["source"], string> = {
  fxtwitter: "Read in full, including long-form body and view count.",
  syndication: "Read via X's embed endpoint.",
  twitterapi: "Read via the configured paid provider.",
  manual: "Pasted by hand.",
};

export function OriginalCard({
  post,
  imageAnalysed,
}: {
  post: SourcePost;
  imageAnalysed?: boolean;
}) {
  const rate = engagementRate(post.engagement);
  const photo = post.media[0];

  return (
    <Panel
      title="Source post"
      right={
        <div className="flex items-center gap-1.5">
          {post.isLongForm && <Chip>long-form</Chip>}
          <Chip title={SOURCE_NOTE[post.source]}>{post.source}</Chip>
        </div>
      }
      bodyClassName=""
    >
      <div className="p-3">
        <div className="flex items-center gap-2">
          {post.author.avatar && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={post.author.avatar}
              alt=""
              width={28}
              height={28}
              className="border border-[var(--rule)]"
            />
          )}
          <div className="min-w-0">
            <div className="text-[13px] font-semibold truncate">
              {post.author.name}
            </div>
            <div className="t-label normal-case tracking-normal truncate">
              @{post.author.handle}
              {post.createdAt
                ? ` · ${new Date(post.createdAt).toLocaleDateString("en-GB", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })}`
                : ""}
            </div>
          </div>
          {post.url && (
            <a
              href={post.url}
              target="_blank"
              rel="noreferrer noopener"
              className="btn btn-sm ml-auto"
            >
              Open
            </a>
          )}
        </div>

        <div className="sunken mt-3 p-3 max-h-[280px] overflow-y-auto scroll-thin">
          <pre className="whitespace-pre-wrap break-words font-[inherit] text-[13px] leading-[1.55] text-[var(--ink)]">
            {post.text}
          </pre>
        </div>

        {post.truncated && (
          <p className="t-label normal-case tracking-normal mt-2" style={{ color: "var(--caution)" }}>
            This source truncated the body. Paste the full post manually for a
            complete read.
          </p>
        )}

        {photo && (
          <figure className="mt-3">
            <div className="sunken p-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo.url}
                alt="Original ad creative"
                className="w-full block"
              />
            </div>
            <figcaption className="t-label normal-case tracking-normal mt-1.5">
              {imageAnalysed === false
                ? "Creative could not be loaded — the visual read was skipped."
                : "Creative read by the vision pass."}
            </figcaption>
          </figure>
        )}
      </div>

      <Lattice cols={3} className="border-b-0 border-r-0">
        <Cell label="Likes" value={compact(post.engagement.likes)} />
        <Cell label="Reposts" value={compact(post.engagement.retweets)} />
        <Cell label="Bookmarks" value={compact(post.engagement.bookmarks)} />
        <Cell label="Replies" value={compact(post.engagement.replies)} />
        <Cell label="Views" value={compact(post.engagement.views)} />
        <Cell
          label="Eng. rate"
          value={rate != null ? `${(rate * 100).toFixed(2)}%` : "—"}
          sub={rate != null ? "likes+reposts+saves / views" : undefined}
        />
      </Lattice>
    </Panel>
  );
}
