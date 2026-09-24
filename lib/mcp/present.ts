import type { SavedClone, SavedSwipe } from "../db/swipes";
import { fieldsToText, getFormat } from "../platforms";

/**
 * A saved run, written out so it can be read.
 *
 * `ok(swipe)` returned the database row as JSON. A host handed a large JSON
 * object summarises it — which is why a finished run came back as a table of
 * scores with the actual ads nowhere in the reply. The copy is the product;
 * the scores are the receipt.
 *
 * So the text block is the ads, laid out as they would be posted, and the
 * structured data still carries everything for anything reading the output
 * rather than the prose.
 */

function scoreLine(c: SavedClone): string {
  const bits = [
    c.originality?.score != null && `originality ${c.originality.score}`,
    c.fidelity?.score != null && `fidelity ${c.fidelity.score}`,
    c.regenerated && "rewritten after a flag",
  ].filter(Boolean);

  return bits.length ? ` — ${bits.join(" · ")}` : "";
}

/** The copy as a reader meets it, preferring the platform-shaped fields. */
function copyOf(swipe: SavedSwipe, clone: SavedClone): string {
  if (!clone.fields || typeof clone.fields !== "object") return clone.body;

  const spec = getFormat(swipe.platform, clone.target_format ?? swipe.target_format);
  const rendered = fieldsToText(spec, clone.fields as Record<string, unknown>);

  // The flattened body is the fallback, not a second-class answer: runs saved
  // before formats existed have nothing else.
  return rendered.trim() || clone.body;
}

export function presentSwipe(swipe: SavedSwipe): string {
  const format = swipe.target_format ? ` · ${swipe.target_format}` : "";

  const header = [
    `Saved run ${swipe.id}`,
    `Source: @${swipe.author_handle ?? "unknown"}${swipe.source_url ? ` — ${swipe.source_url}` : ""}`,
    `Written for: ${swipe.platform ?? "x"}${format}`,
    swipe.hook_type ? `Hook type: ${swipe.hook_type}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const clones = (swipe.clones ?? []).map((c) => {
    const parts = [
      `━━━ ${c.angle}${scoreLine(c)} ━━━`,
      "",
      copyOf(swipe, c),
    ];

    if (c.rationale) parts.push("", `Why this angle: ${c.rationale}`);

    if (c.fidelity?.drifted?.length) {
      parts.push("", "Noted:", ...c.fidelity.drifted.map((d) => `  • ${d}`));
    }

    parts.push(
      "",
      c.image_url
        ? "Creative: attached below."
        : c.image_prompt
          ? `Creative: not rendered. Prompt is saved — "${c.image_prompt.slice(0, 160)}"`
          : "Creative: none.",
    );

    return parts.join("\n");
  });

  return [
    header,
    "",
    clones.join("\n\n"),
    "",
    "--- source ad ---",
    swipe.original_text,
  ].join("\n");
}
