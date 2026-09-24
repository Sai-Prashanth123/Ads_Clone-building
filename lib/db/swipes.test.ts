import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * The save path, held to the two things that broke it in production.
 *
 * Both were invisible from the outside: a NOT NULL column the MCP tool could
 * not supply, and a partial failure that left a source-only record behind. The
 * Supabase client is stubbed because what matters is the shape of what gets
 * written and what happens when the second write fails — neither needs a
 * database to check.
 */

const inserted: { table: string; rows: unknown }[] = [];
const deleted: { table: string; id: string }[] = [];
let clonesInsertFails = false;

vi.mock("./client", () => ({
  CREATIVES_BUCKET: "creatives",
  getDb: () => ({
    from(table: string) {
      return {
        insert(rows: unknown) {
          inserted.push({ table, rows });
          if (table === "clones" && clonesInsertFails) {
            return Promise.resolve({ error: { message: "boom" } });
          }
          return {
            select: () => ({
              single: () =>
                Promise.resolve({ data: { id: "swipe-1" }, error: null }),
            }),
            then: (r: (v: unknown) => unknown) => r({ error: null }),
          };
        },
        delete: () => ({
          eq: (_col: string, id: string) => {
            deleted.push({ table, id });
            return Promise.resolve({ error: null });
          },
        }),
      };
    },
    storage: {
      from: () => ({
        upload: () => Promise.resolve({ error: null }),
        move: () => Promise.resolve({ error: null }),
        getPublicUrl: (p: string) => ({
          data: { publicUrl: `https://store.test/creatives/${p}` },
        }),
        list: () => Promise.resolve({ data: [] }),
        remove: () => Promise.resolve({ error: null }),
      }),
    },
  }),
  isSwipeFileEnabled: () => true,
  SWIPE_FILE_SETUP_HINT: "",
}));

const { saveSwipe } = await import("./swipes");

const post = {
  id: "1",
  url: "https://x.com/a/status/1",
  author: { name: "A", handle: "a" },
  text: "source",
  media: [],
  engagement: {},
  source: "manual",
} as Parameters<typeof saveSwipe>[0]["post"];

const dna = {} as Parameters<typeof saveSwipe>[0]["dna"];

const variation = (extra: Record<string, unknown> = {}) =>
  ({ angle: "direct-swap", text: "clone", ...extra }) as unknown as Parameters<
    typeof saveSwipe
  >[0]["variations"][number];

beforeEach(() => {
  inserted.length = 0;
  deleted.length = 0;
  clonesInsertFails = false;
});

describe("saving a run", () => {
  /* `regenerated` is NOT NULL and was never in the MCP tool's input schema, so
   * every save from a host failed on a column the caller could not see. */
  it("never writes a null into a column the caller cannot supply", async () => {
    await saveSwipe({ post, dna, variations: [variation()] });

    const clones = inserted.find((i) => i.table === "clones");
    const row = (clones!.rows as Record<string, unknown>[])[0];

    expect(row.regenerated).toBe(false);
    expect(row.regenerated).not.toBeUndefined();
  });

  it("keeps a caller's own regenerated flag", async () => {
    await saveSwipe({
      post,
      dna,
      variations: [variation({ regenerated: true })],
    });

    const clones = inserted.find((i) => i.table === "clones");
    expect((clones!.rows as Record<string, unknown>[])[0].regenerated).toBe(true);
  });

  /* Three save attempts left three source-only records with zero variations.
   * A swipe without its clones is not a useful record of anything. */
  it("leaves nothing behind when the clones fail to write", async () => {
    clonesInsertFails = true;

    await expect(
      saveSwipe({ post, dna, variations: [variation()] }),
    ).rejects.toThrow("boom");

    expect(deleted).toEqual([{ table: "swipes", id: "swipe-1" }]);
  });

  it("adopts a staged creative rather than demanding raw bytes", async () => {
    await saveSwipe({
      post,
      dna,
      variations: [variation()],
      images: {
        "direct-swap": {
          url: "https://store.test/creatives/pending/abc.png",
          prompt: "a forum post",
        },
      },
    });

    const clones = inserted.find((i) => i.table === "clones");
    const row = (clones!.rows as Record<string, unknown>[])[0];

    // Moved under the swipe, so deleting the swipe removes it too.
    expect(String(row.image_url)).toContain("swipe-1/");
    expect(String(row.image_url)).not.toContain("pending/");
  });

  it("records the format the copy was written for", async () => {
    await saveSwipe({
      post,
      dna,
      variations: [variation()],
      platform: "x",
      format: "thread",
    });

    const swipes = inserted.find((i) => i.table === "swipes");
    expect((swipes!.rows as Record<string, unknown>).target_format).toBe("thread");
  });
});

describe("columns the caller never supplies", () => {
  /* PostgREST sends an explicit null for an undefined property, and an explicit
   * null overrides a column default — so a NOT NULL column with a perfectly
   * good default still fails. `regenerated`, `originality` and `beat_mapping`
   * each broke this way in turn, one deploy apart, which is why the row is
   * cleaned as a whole rather than one column at a time. */
  it("omits them entirely so the column default applies", async () => {
    await saveSwipe({ post, dna, variations: [variation()] });

    const row = (inserted.find((i) => i.table === "clones")!
      .rows as Record<string, unknown>[])[0];

    for (const column of ["originality", "beat_mapping", "fidelity", "spec_report"]) {
      expect(
        Object.prototype.hasOwnProperty.call(row, column) &&
          row[column] === undefined,
        `${column} would be sent as an explicit null`,
      ).toBe(false);
    }
  });

  it("still writes the values the caller did supply", async () => {
    await saveSwipe({
      post,
      dna,
      variations: [
        variation({
          originality: { score: 91, pass: true },
          beatMapping: [{ role: "hook", line: "a line" }],
        }),
      ],
    });

    const row = (inserted.find((i) => i.table === "clones")!
      .rows as Record<string, unknown>[])[0];

    expect(row.originality).toEqual({ score: 91, pass: true });
    expect(row.beat_mapping).toEqual([{ role: "hook", line: "a line" }]);
  });
});
