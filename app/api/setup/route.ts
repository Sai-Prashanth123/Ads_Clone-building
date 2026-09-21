import { describeSetup } from "@/lib/ai/provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lets the console show which provider is actually live and offer only the
 * image models this deployment can render — rather than listing three models
 * and failing on two of them.
 */
export async function GET() {
  const setup = describeSetup();

  return Response.json(
    {
      provider: setup.provider
        ? {
            id: setup.provider.id,
            label: setup.provider.label,
            envVar: setup.provider.envVar,
            signupUrl: setup.provider.signupUrl,
          }
        : null,
      imageProvider: setup.imageProvider,
      canGenerateImages: setup.canGenerateImages,
      imageChoices: setup.imageChoices,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
