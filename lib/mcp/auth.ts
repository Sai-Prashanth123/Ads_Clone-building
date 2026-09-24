import type { AuthInfo } from "@modelcontextprotocol/server";

/**
 * Bearer-token gate for the MCP endpoint.
 *
 * This is not decoration. The server can delete the swipe file and spend the
 * Cloudflare image quota, and MCP URLs end up pasted into config files, chat
 * logs and screenshots. An unauthenticated write endpoint on a public HTTPS
 * URL is a matter of when, not if.
 *
 * Deliberately a static shared secret rather than OAuth: this is a personal
 * server with one operator, and both Claude and ChatGPT accept a bearer token.
 * OAuth is the right answer the day someone else needs their own view of the
 * data, and not before.
 */

export const MCP_SCOPES = ["adclone:read", "adclone:write"] as const;

export function mcpAuthConfigured(): boolean {
  return Boolean(process.env.MCP_AUTH_TOKEN?.trim());
}

/** Constant-time compare, so a wrong token leaks nothing through timing. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Returns an AuthInfo when the bearer token matches, undefined otherwise.
 * `withMcpAuth` turns undefined into a 401 before any tool runs.
 */
export function verifyMcpToken(
  _req: Request,
  bearerToken?: string,
): AuthInfo | undefined {
  const expected = process.env.MCP_AUTH_TOKEN?.trim();

  // Refuse to serve rather than fall open. A server that quietly accepts
  // everyone because a variable is unset is worse than one that refuses.
  if (!expected) return undefined;
  if (!bearerToken) return undefined;
  if (!safeEqual(bearerToken, expected)) return undefined;

  return {
    token: bearerToken,
    scopes: [...MCP_SCOPES],
    clientId: "adclone-operator",
    // No expiry: a static operator token, rotated by changing the env var.
    extra: { kind: "static-bearer" },
  };
}
