import {
  ResourceTemplate,
  type McpServer,
} from "@modelcontextprotocol/server";
import { isSwipeFileEnabled } from "../db/client";
import { listSwipes } from "../db/swipes";
import { buildPlaybook } from "../analysis/playbook";
import { PLATFORMS, PLATFORM_IDS, generationMax } from "../platforms";

/**
 * Resources are the things worth pulling into context without spending a tool
 * call on them: the platform specs a host needs before writing anything, and
 * the accumulated pattern report.
 */
export function registerResources(server: McpServer): void {
  server.registerResource(
    "platform-specs",
    "adclone://platforms",
    {
      title: "Ad platform formats",
      description:
        "Field structure, character limits and aspect ratios for every supported platform.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(
            PLATFORM_IDS.map((id) => {
              const spec = PLATFORMS[id];
              return {
                id: spec.id,
                label: spec.label,
                formatName: spec.formatName,
                aspectRatios: spec.aspectRatios,
                ctaOptions: spec.ctaOptions,
                fields: spec.fields.map((f) => ({
                  key: f.key,
                  hardLimit: f.max,
                  truncatesAt: f.recommended,
                  writeAtMost: generationMax(f),
                  repeat: f.repeat,
                })),
              };
            }),
            null,
            2,
          ),
        },
      ],
    }),
  );

  server.registerResource(
    "playbook",
    "adclone://playbook",
    {
      title: "Niche playbook",
      description:
        "What the saved ads have in common — hook types, structures and triggers, counted from stored data.",
      mimeType: "application/json",
    },
    async (uri) => {
      const text = isSwipeFileEnabled()
        ? JSON.stringify(await buildPlaybook(), null, 2)
        : JSON.stringify({ error: "Swipe file not configured." });

      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text }],
      };
    },
  );

  server.registerResource(
    "swipe",
    new ResourceTemplate("adclone://swipe/{id}", { list: undefined }),
    {
      title: "A saved ad",
      description: "One saved ad with its framework and variations.",
      mimeType: "application/json",
    },
    async (uri, { id }) => {
      if (!isSwipeFileEnabled()) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify({ error: "Swipe file not configured." }),
            },
          ],
        };
      }

      const all = await listSwipes({ limit: 50 });
      const swipe = all.find((s) => s.id === id);

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(swipe ?? { error: `No swipe ${id}.` }, null, 2),
          },
        ],
      };
    },
  );
}
