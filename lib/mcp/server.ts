import type { McpServer } from "@modelcontextprotocol/server";
import { registerSourceTools } from "./tools/source";
import { registerGuardTools } from "./tools/guards";
import { registerCreativeTools } from "./tools/creative";
import { registerMemoryTools } from "./tools/memory";
import { registerBatchTools } from "./tools/batch";
import { registerOrchestrationTools } from "./tools/orchestrate";
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
  "3. get_platform_spec — the target's real field names and limits. Each platform has SEVERAL formats (thread, carousel, story, search ad); pick the one whose shape matches the source rather than defaulting to the single image.",
  "4. get_reference_ads — the saved ads that measurably worked in this niche, as calibration.",
  "5. Write the variations: same skeleton, every surface changed.",
  "6. VERIFY with check_clone. One call returns all three verdicts — originality against the source, fidelity to its shape, and the platform's character limits.",
  "7. Revise what it names and check again. This loop is the product.",
  "8. generate_images — ONE call with every variation's prompt, so the whole set comes back together and can be compared. Then save_swipe with each imageUrl, and get_swipe to show the finished run. Do not answer with a link to the library when the work can be shown here.",
  "",
  "Or call clone_ad_auto, which runs that whole loop itself: it asks you to write, measures the result, and comes back with exactly what failed until it passes. Nothing unverified reaches the caller. Use it when you want the finished answer; use the individual tools when you want to make the calls yourself.",
  "",
  "Three rules that matter:",
  "• Never present copy that has not passed the guards. They return arithmetic — you cannot assess character counts or n-gram overlap by eye, and a confident guess is worse than a measurement.",
  "• Never reproduce the source's wording. The guards will catch it, and catching it late wastes the run.",
  "• A clone has to pass BOTH axes. High originality alone means you may have written a good ad that is not a clone of this one; check_clone shows the pair together because the pair is the signal.",
  "",
  "Start with the clone_ad prompt if you want the whole sequence.",
].join("\n");

export function registerEverything(server: McpServer): void {
  registerSourceTools(server);
  registerGuardTools(server);
  registerCreativeTools(server);
  registerMemoryTools(server);
  registerBatchTools(server);
  registerOrchestrationTools(server);
  registerPrompts(server);
  registerResources(server);
}
