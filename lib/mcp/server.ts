import type { McpServer } from "@modelcontextprotocol/server";
import { registerSourceTools } from "./tools/source";
import { registerGuardTools } from "./tools/guards";
import { registerCreativeTools } from "./tools/creative";
import { registerMemoryTools } from "./tools/memory";
import { registerBatchTools } from "./tools/batch";
import { registerPrompts } from "./prompts";
import { registerResources } from "./resources";

export const MCP_SERVER_INFO = {
  name: "adclone-studio",
  version: "1.0.0",
} as const;

/**
 * Instructions the host reads once, at connection.
 *
 * Worth as much as any individual tool description: without them a model will
 * write three variations, show them, and never call the guards — which is
 * exactly the behaviour this whole architecture exists to prevent.
 */
export const MCP_INSTRUCTIONS = [
  "AdClone Studio deconstructs high-performing ads and rebuilds them as fresh copy that provably is not lifted.",
  "",
  "You do the thinking. This server does what you cannot do reliably: fetching ads, counting characters, measuring text similarity, rendering images, and remembering what was saved.",
  "",
  "The workflow:",
  "1. fetch_ad — copy, engagement, and the creative as an image you read yourself.",
  "2. Deconstruct the framework: hook type, beat structure, formatting habits, audience, persuasion triggers, and what the visual DOES. Mechanics, not content.",
  "3. get_platform_spec — the target's real field names and limits.",
  "4. Write the variations: same skeleton, every surface changed.",
  "5. VERIFY. validate_ad, check_originality against the source, check_convergence across the set.",
  "6. Revise anything flagged and check again. This loop is the product.",
  "7. generate_image, then save_swipe.",
  "",
  "Two rules that matter:",
  "• Never present copy that has not passed the guards. They return arithmetic — you cannot assess character counts or n-gram overlap by eye, and a confident guess is worse than a measurement.",
  "• Never reproduce the source's wording. The guards will catch it, and catching it late wastes the run.",
  "",
  "Start with the clone_ad prompt if you want the whole sequence.",
].join("\n");

export function registerEverything(server: McpServer): void {
  registerSourceTools(server);
  registerGuardTools(server);
  registerCreativeTools(server);
  registerMemoryTools(server);
  registerBatchTools(server);
  registerPrompts(server);
  registerResources(server);
}
