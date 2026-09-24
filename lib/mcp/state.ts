import { createHash, randomBytes } from "node:crypto";
import { createRequestStateCodec } from "@modelcontextprotocol/server";

/**
 * Signed state for the multi-round-trip tools.
 *
 * `clone_ad_auto` cannot hold its loop in memory: each sampling round returns
 * to the client and the handler is entered again from scratch. The loop's state
 * therefore travels through the client — which means it comes back as input the
 * caller could have edited. The round counter is the part that matters: without
 * integrity protection a client could reset it to 0 forever and the revise loop
 * would never terminate.
 *
 * So it is HMAC-signed. The SDK applies no protection by default and says so;
 * this is the spec's integrity requirement, met with the SDK's own helper.
 *
 * The payload is SIGNED, NOT ENCRYPTED — the client can read it. Nothing secret
 * goes in it, which is why the state carries the source text rather than a
 * database handle to it.
 */

export type AutoCloneState = {
  /** Which revise round is about to be attempted, 1-based. */
  round: number;
  platform: string;
  format?: string;
  angles: string[];
  source: {
    text: string;
    url: string | null;
    author: string | null;
  };
  /** The best-scoring attempt so far, so a give-up still returns something. */
  best?: {
    round: number;
    originality: number;
    fidelity: number;
    draft: unknown;
    failing: string[];
  };
};

/**
 * The HMAC key.
 *
 * Derived from a configured secret where one exists, so every instance behind a
 * load balancer verifies what any other minted. The fallback is a per-process
 * random key, which is correct but only works when one process serves every
 * round of a flow — on a single Render instance that holds, and on a multi-
 * instance deploy a round can land elsewhere and be rejected. Rejection is the
 * safe direction, and MCP_STATE_SECRET removes the problem.
 */
function stateKey(): Uint8Array {
  const configured =
    process.env.MCP_STATE_SECRET || process.env.MCP_AUTH_TOKEN || "";

  if (configured) {
    // Hashed rather than used raw: the codec needs 32 bytes, and a short token
    // would otherwise throw at construction.
    return new Uint8Array(createHash("sha256").update(configured).digest());
  }

  return new Uint8Array(randomBytes(32));
}

/**
 * One codec per process. Re-minting the key per call would invalidate every
 * state in flight, which is exactly the bug the fallback path is prone to.
 */
let codec: ReturnType<typeof createRequestStateCodec<AutoCloneState>> | null =
  null;

export function autoCloneState() {
  codec ??= createRequestStateCodec<AutoCloneState>({
    key: stateKey(),
    // A clone loop that has sat idle for ten minutes is abandoned, not paused.
    ttlSeconds: 900,
    // Bound to the method and the authenticated caller: state minted for one
    // principal cannot be replayed by another.
    bind: (ctx) =>
      `${ctx.mcpReq.method}\u0000${
        (ctx as { http?: { authInfo?: { clientId?: string } } }).http?.authInfo
          ?.clientId ?? ""
      }`,
  });

  return codec;
}

/** True when a configured secret makes the signature survive a restart. */
export function stateSecretConfigured(): boolean {
  return Boolean(process.env.MCP_STATE_SECRET || process.env.MCP_AUTH_TOKEN);
}
