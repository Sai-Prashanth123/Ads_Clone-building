import { createMcpHandler, withMcpAuth } from "mcp-handler";
import {
  MCP_INSTRUCTIONS,
  MCP_SERVER_INFO,
  registerEverything,
} from "@/lib/mcp/server";
import { mcpAuthConfigured, verifyMcpToken } from "@/lib/mcp/auth";
import { autoCloneState } from "@/lib/mcp/state";

/**
 * The MCP endpoint.
 *
 * `[transport]` catches both /mcp (streamable HTTP) and /sse (the deprecated
 * transport some clients still open with), so one route serves every client.
 *
 * Node runtime, not edge: the tools reach Supabase, Cloudflare and the X
 * adapters, and a long image render has no business on an edge budget.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const handler = createMcpHandler(
  (server) => {
    registerEverything(server);
  },
  {
    serverInfo: MCP_SERVER_INFO,
    instructions: MCP_INSTRUCTIONS,
    verboseLogs: process.env.NODE_ENV !== "production",

    /*
     * Multi-round-trip state is verified before any handler sees it.
     *
     * clone_ad_auto's revise loop keeps its round counter here, and the value
     * travels through the client between rounds — so on the way back it is
     * input the caller could have edited. Without this hook the counter is
     * whatever the client says it is, and a client that keeps sending round 1
     * gets an unbounded loop. The codec's verify throws on a bad signature,
     * which the SDK answers as an invalid-params error, and hands the decoded
     * payload to the handler so nothing decodes it twice.
     */
    requestState: { verify: autoCloneState().verify },
  },
);

/**
 * Auth is required whenever a token is configured.
 *
 * `required` is deliberately tied to the env var rather than hardcoded: a
 * local dev server with no token stays open for curl, while any deployment
 * that sets MCP_AUTH_TOKEN refuses unauthenticated calls. The failure mode
 * that matters — a public URL silently accepting everyone — cannot happen,
 * because verifyMcpToken returns undefined when the variable is unset.
 */
const authed = withMcpAuth(handler, verifyMcpToken, {
  required: mcpAuthConfigured(),
  requiredScopes: [],
});

export { authed as GET, authed as POST, authed as DELETE };
