import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mcpAuthConfigured, verifyMcpToken } from "./auth";

const TOKEN = "mcp_test_token_0123456789abcdef";
const req = new Request("https://example.com/mcp");

describe("verifyMcpToken", () => {
  const original = process.env.MCP_AUTH_TOKEN;

  beforeEach(() => {
    process.env.MCP_AUTH_TOKEN = TOKEN;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.MCP_AUTH_TOKEN;
    else process.env.MCP_AUTH_TOKEN = original;
  });

  it("accepts the configured token", () => {
    const auth = verifyMcpToken(req, TOKEN);
    expect(auth?.token).toBe(TOKEN);
    expect(auth?.scopes).toContain("adclone:write");
  });

  it("rejects a wrong token", () => {
    expect(verifyMcpToken(req, "not-the-token")).toBeUndefined();
  });

  it("rejects a missing token", () => {
    expect(verifyMcpToken(req, undefined)).toBeUndefined();
  });

  it("rejects a token that is merely a prefix", () => {
    // Length is compared first, so a truncated token cannot slip through.
    expect(verifyMcpToken(req, TOKEN.slice(0, -1))).toBeUndefined();
  });

  it("fails CLOSED when no token is configured", () => {
    // The dangerous failure is a deployed server that accepts everyone
    // because an env var went missing. It must refuse, not fall open.
    delete process.env.MCP_AUTH_TOKEN;
    expect(verifyMcpToken(req, TOKEN)).toBeUndefined();
    expect(verifyMcpToken(req, undefined)).toBeUndefined();
    expect(mcpAuthConfigured()).toBe(false);
  });

  it("treats a blank token as unconfigured", () => {
    process.env.MCP_AUTH_TOKEN = "   ";
    expect(mcpAuthConfigured()).toBe(false);
    expect(verifyMcpToken(req, "   ")).toBeUndefined();
  });
});
