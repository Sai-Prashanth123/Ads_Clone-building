import type { CallToolResult } from "@modelcontextprotocol/server";

/**
 * Tool results, in the one shape every tool here uses.
 *
 * MCP carries results as content blocks, so structured data is serialised as
 * JSON text. `structuredContent` is sent alongside for hosts that read it,
 * but the text block is what most models actually see — so it must be the
 * readable form, not a stringified blob with no shape.
 */
export function ok(data: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data as Record<string, unknown>,
  };
}

/**
 * A failure the model should act on rather than retry blindly.
 *
 * `isError` makes the host treat it as a tool failure, and the message says
 * what to do instead — a tool that fails silently or unhelpfully just gets
 * called again with the same arguments.
 */
export function fail(message: string): CallToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

/** Text plus an image the host can actually look at. */
export function withImage(
  text: string,
  image: { base64: string; mediaType: string },
): CallToolResult {
  return {
    content: [
      { type: "text", text },
      { type: "image", data: image.base64, mimeType: image.mediaType },
    ],
  };
}
