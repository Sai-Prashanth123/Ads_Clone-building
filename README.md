# AdClone Studio

Paste an X post that performed. The studio reads *why* it worked, then rebuilds it
as three fresh angles — new copy, new creative — and proves the result isn't lifted.

This is **creative deconstruction**, not ad-account cloning. It does not touch the X
Ads API, and it cannot read anyone's targeting or budgets (nobody can, for accounts
they don't own). It works on the public post.

---

## What it does

```
paste link → read post → deconstruct framework → write angles → enforce originality + fidelity → generate creative
```

1. **Read the post.** Full text (including long-form), author, engagement, and the
   creative at original resolution.
2. **Deconstruct it.** A vision pass reads the copy *and* the image and extracts the
   transferable machinery: hook type, beat structure, formatting habits, audience
   sophistication, persuasion triggers, proof type, CTA style, and the visual's
   layout / palette / subject / job.
3. **Rewrite it.** Three angles by default — *direct swap*, *aggressive*,
   *minimalist*, from eight available — that keep the skeleton and change every
   surface. The brief carries the source's measured shape, so "keep the skeleton"
   is a set of targets rather than a hope. Each ships with a beat mapping showing
   which original beat each new line serves.
4. **Check it.** Every variation is scored against the original in plain code, on
   both axes: is the wording new, and is it still the same ad. See
   [Originality and fidelity](#originality-and-fidelity) — this is the part that
   makes the promise real.
5. **Render creative.** Per-variation image prompts, three models to choose from.

Optionally turn on a **brand profile** and the framework gets retargeted onto *your*
product instead of producing a generic rewrite.

---

## Setup

```bash
npm install
cp .env.example .env.local     # add ONE provider key
npm run dev
```

The studio is not tied to one billing account. Set **any one** of these and it
auto-detects at startup. The console header shows which provider is live, and
the image picker only offers models that provider can actually render.

| Key | Copy analysis | Reads source creative | Generates creative |
|---|---|---|---|
| `GOOGLE_GENERATIVE_AI_API_KEY` — **start here**, free tier | yes | yes | yes |
| `AI_GATEWAY_API_KEY` — one key, every model | yes | yes | yes |
| `ANTHROPIC_API_KEY` | yes | yes | no — hands you the prompt instead |
| `OPENAI_API_KEY` | yes | yes | yes |

[Google AI Studio](https://aistudio.google.com/apikey) is the recommended
start: its free tier is the only one that covers *both* the vision pass and
image generation, so the whole pipeline runs on one free key.

> On the Vercel AI Gateway, the $5 free credits cannot actually be spent —
> every model returns `429 Free tier requests on this model are rate-limited`
> until the team tops up to paid credits. Verified against the live API, not
> assumed.

**No scraping credentials are needed** either. No Apify, no RapidAPI, no
$200/mo X API tier.

---

---

## Use it from Claude or ChatGPT (MCP)

The studio is also an **MCP server**, and that inverts the architecture: the
host model reads the ad, extracts the framework and writes the copy, while this
server does what a language model cannot do reliably — fetching, counting
characters, measuring text similarity, rendering images, and remembering.

No Gemini key is needed for that path. The intelligence is the one you are
already talking to.

- **Endpoint:** `https://adclone-studio.onrender.com/mcp`
- **Auth:** bearer token, from `MCP_AUTH_TOKEN`

**Claude** — Settings → Connectors → Add custom connector. Paste the URL and
the bearer token.

**ChatGPT** — Settings → Connectors → **Developer mode**, then add the URL and
token. Developer mode is what permits arbitrary tools. The server also exposes
`search` and `fetch` in ChatGPT's fixed contract, so it works in Deep Research.

**Claude Code** — `claude mcp add --transport http adclone <url>` with an
`Authorization: Bearer …` header.

### What it exposes

**Guards** — the reason this is worth wiring up. `check_clone` returns all
three verdicts at once: originality against the source, structural fidelity to
it, and every field against the platform's published limits. The individual
tools (`check_originality`, `check_fidelity`, `check_convergence`,
`validate_ad`) are there when you want one axis alone. They return arithmetic,
not opinions — a model cannot count characters or measure n-gram overlap
against a 2,000-word source by eye; it will produce a confident number that is
wrong. And because the host can call them repeatedly, it gets a loop the
server-side pipeline never had: write, measure, revise, measure again.

Two axes, not one. Unrelated text scores 100% original and 0% faithful; a
verbatim copy is the reverse. A good clone is high on both, and nothing else
can tell a faithful rewrite from a draft that wandered into a different ad. See
[Originality and fidelity](#originality-and-fidelity).

**Orchestration** — `clone_ad_auto` runs the whole loop itself: fetch,
deconstruct, write, measure, and revise with the exact failure quoted, up to
three rounds, before returning anything. It generates by asking *your* model
(MCP sampling), so no external key is involved and the writing is yours. Every
other tool here is a capability the host may choose to use; this one makes the
verify-and-revise loop structural, because the caller never sees copy that has
not been measured.

On a connection that cannot carry a sampling round it returns the complete
brief instead — same instructions, same reference ads — and says so. Nothing
half-works silently.

**Source** — `fetch_ad` returns the copy plus the creative as an image block
the host reads itself. When a URL turns out to be blocked, it asks the operator
to paste the copy mid-call rather than failing with advice. `fetch_ads` for a
set.

**Formats** — `get_platform_spec` lists every format each platform offers, not
just the single image: X threads, LinkedIn and Meta carousels, Meta stories,
Google responsive search ads. The choice matters more than the wording — a
long-form listicle cloned into one post loses the list; cloned into a thread it
keeps it. Carousels and threads come back as repeating card groups, and
`validate_ad` reports off-spec copy by position ("Card 3 · Card headline is 6
over").

**Creative** — `generate_image`, on Cloudflare's free FLUX tier.

**Memory** — `save_swipe`, `list_swipes`, `get_swipe`, `delete_swipe`,
`get_playbook`, and `get_reference_ads`. The last one returns the
best-performing saved ads of a given hook type, ranked by engagement *rate*
rather than raw likes, as grounding to write against. The swipe file had been
collecting that the whole time and generation never used it.

Both front doors write the same data, so anything saved from a chat shows up at
`/library`.

**Batch** — `create_batch` and friends, only when `GOOGLE_GENERATIVE_AI_API_KEY`
is set. Unattended runs outlive a conversation, so they still need a
server-side model; without the key those tools say so and point at the
host-driven path rather than failing obscurely.

**Prompts** — `clone_ad` runs the whole sequence. `deconstruct_ad` and
`write_variations` carry the craft instructions from the server-side pipeline,
where they were tuned against real output.

Write and delete tools are annotated so both hosts confirm before acting. With
no token configured the endpoint refuses every request rather than falling
open — the failure that matters for a server that can delete your swipe file.

`clone_ad_auto` carries its revise-loop state through the client between
rounds, which means it comes back as input the caller could have edited. It is
HMAC-signed and verified before any handler reads it: without that, a client
could reset the round counter and loop forever. Set `MCP_STATE_SECRET` (or rely
on `MCP_AUTH_TOKEN`) so the signature survives a restart and holds across more
than one instance.

---

## Where the post data comes from

Three adapters, first success wins, then a manual floor:

| Adapter | Key | Notes |
|---|---|---|
| **fxtwitter** | none | Primary. The only free source tested that returns long-form posts **whole**, plus view counts, bookmarks and `?name=orig` media. |
| **syndication** | none | Backup — X's own embed endpoint. Truncates long-form at ~276 chars, so it flags `truncated` when it does. |
| **twitterapi.io** | `TWITTERAPI_IO_KEY` | Optional. Entirely inert unless the key is set. |
| **manual paste** | — | The guaranteed floor. Protected, deleted or age-restricted posts still work; everything downstream is identical. |

That truncation difference is not academic — on a real listicle ad the syndication
endpoint returned **276 characters** where fxtwitter returned **2,765**. Analysing
the short version would have silently gutted the result for exactly the posts most
worth cloning.

---

## Originality and fidelity

"Same framework, different words" is the entire product promise. Both halves are
enforced in deterministic code, not left to the model's good intentions. No AI
calls — cheap, repeatable, and unit-tested.

### Different words — `lib/originality.ts`

Three independent signals, because each alone is easy to game:

| Signal | Catches | Fails at |
|---|---|---|
| n-gram overlap (word 5-grams, Jaccard) | wholesale paraphrase | `> 0.18` |
| longest shared run | one lifted sentence in otherwise fresh copy | `≥ 6 words` |
| rare-word overlap | lifted distinctive vocabulary | `> 0.35` |

The second signal is why there are three. A single lifted sentence buried in a
long original dilutes to almost nothing under n-gram overlap — there's a test for
exactly that case.

### Same framework — `lib/fidelity.ts`

The other half went unmeasured for a long time. `beatMapping` looked like proof
that the skeleton survived, but it was the model asserting it had kept the
structure — an assertion stored in the database and rendered in the UI as a
receipt, which nothing had ever checked.

So the shape is fingerprinted from the text and compared:

| Dimension | Weight | What it catches |
|---|---|---|
| opening move | 0.20 | a number hook becoming a question |
| list shape | 0.20 | three scannable bullets becoming a paragraph |
| sentence rhythm | 0.15 | punchy one-liners becoming flowing prose |
| stat density | 0.15 | specific figures going vague |
| closing move | 0.10 | an ad that stops pointing anywhere |
| block rhythm | 0.10 | the line-break pattern collapsing |
| emphasis | 0.10 | emoji and caps discipline drifting |

Below 60/100 the clone has stopped being the same ad. `drifted[]` names what
changed in words you can act on — *"the original opens with a number; yours
opens with a question"* — because a score alone tells a writer nothing.

The two axes pull against each other, which is the point. Unrelated text scores
100% original and 0% faithful; a verbatim copy is the reverse. A good clone is
high on **both**, and neither guard alone can tell a faithful rewrite from a
draft that wandered into a different ad. There is a test that holds exactly
that: copy the originality guard waves through, which the fidelity guard fails.

Two judgement calls are worth knowing about. A CTA button and a "link below" are
scored as the *same* closing move — which one an ad uses is decided by the
platform, not the writer, and treating them as unrelated reported drift on the
single most common correct adaptation there is. And the structural targets are
measured from the source and handed to the model up front, including how many
list items actually fit the target field: a three-item list and a 210-character
LinkedIn intro are not both satisfiable, and the field limit always wins.

### The loop

Anything that fails either guard is sent back to the model **once**, with its own
lifted phrases quoted as exclusions and its lost structure quoted as targets. The
better of the two attempts wins per angle, where "better" is the pair — a rewrite
that recovers the shape by borrowing the source's wording is worse than the draft
it replaced. If it still fails, the card says so; the studio never silently ships
near-copy or a clone that is not one.

Over MCP the loop is unbounded: the host can measure and revise until it passes.
`clone_ad_auto` makes it mandatory.

```bash
npm test          # both guards' test suites
```

---

## Swipe file

Every run can be saved — the source post, its extracted DNA, every clone with
its originality and fidelity reports, and any creative you generated. `/library`
searches them by copy, author, or hook type as the collection grows.

Backed by Supabase (Postgres + object storage). Set:

```
SUPABASE_URL=
SUPABASE_SECRET_KEY=
```

Neither is prefixed `NEXT_PUBLIC_`, deliberately: that prefix inlines a value
into the browser bundle. All queries run server-side in `app/api/swipes`, so
the client never needs credentials.

Without them the studio works fully — it just doesn't remember anything.

Schema notes:

- `swipes.hook_type` is a **generated column** off `dna -> 'hook' ->> 'type'`,
  so the library filters by hook without unpacking JSON on every row.
  `clones.originality_score` / `originality_pass` work the same way.
- Deleting a swipe cascades to its clones **and** explicitly removes its
  creatives from object storage. Storage is not covered by the foreign key, so
  without that step every delete would leave an invisible orphaned blob —
  caught by round-trip testing the real database, not by the type checker.

> **Security:** credentials are server-side only — a production build has been
> checked for them and the browser bundle contains none. With
> `SUPABASE_SECRET_KEY` set, the RLS policies deny `anon` outright, so the
> database is unreachable except through this app's own API routes.
>
> Those routes are still unauthenticated. A public deployment therefore needs
> a gate in front of it — Render/Vercel access protection, or real auth — or
> anyone with the URL can use the studio and your swipe file.

## Models

Chosen by `lib/ai/provider.ts` from whichever key is present. On the Gateway
these are plain `provider/model` strings; direct providers use their own SDK.

**Analysis / copy** — needs vision to read the source creative. Listed in fallback order: free-tier quota is metered *per model*, so a rate-limited model is not a rate-limited account.

| Provider | Model |
|---|---|
| Gateway | `anthropic/claude-opus-5` |
| Google | `gemini-3.6-flash` → `gemini-3.5-flash` → `gemini-3-flash-preview` |
| Anthropic | `claude-opus-5` |
| OpenAI | `gpt-5.6-sol` |

**Image generation is chosen independently of analysis.** This matters: Google's
free tier covers vision but gives image models *zero* quota (`limit: 0`), so the
working combination is Gemini for the thinking and Cloudflare for the rendering.
`detectImageProvider()` is separate from `detectProvider()` for exactly that reason.

| Key | Models | Cost |
|---|---|---|
| `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` | `flux-1-schnell`, `sdxl` | **free** — 10,000 neurons/day ≈ 190 images |

Cloudflare needs an **API Token**, not a Global API Key. Create one at My Profile →
API Tokens → Create Custom Token with `Account → Workers AI → Read`; it starts
`cfut_`. A `cfk_` value is a Global API Key, uses a different auth scheme, and is
rejected up front with an explanation rather than an opaque 401.

Two Cloudflare quirks worth knowing, both handled:

- `flux-1-schnell` accepts **only** `prompt` and `steps` — passing `width`/`height`
  is a hard 400. Aspect ratio is steered through the prompt instead, and negatives
  are folded into it since the model takes no negative prompt.
- `sdxl` does honour exact dimensions and a negative prompt, and returns raw PNG
  bytes where flux returns base64 JSON. Pick sdxl when the frame shape matters.

**Creative via the other providers** — the picker only shows what the live provider
can render:

- `gpt-image-2.5-sunburst` — sharpest text rendering, for headline / chart / UI creative
- `seedream-5.0-pro` *(gateway only)* — flat $0.035, strong aesthetics, little embedded text
- `gemini-3-pro-image` — takes the **original image as input**, so it varies the real
  composition instead of working from a description

If the provider has no image model (Anthropic), the card hands you the image
prompt to paste elsewhere instead of offering a button that would fail.

---

## Layout

```
app/
  page.tsx              the console
  library/page.tsx      the swipe file
  [transport]/route.ts  the MCP endpoint (/mcp and /sse)
  api/clone/route.ts    NDJSON pipeline stream (fetch → dna → variations)
  api/image/route.ts    creative generation
  api/swipes/route.ts   swipe file save / list / delete
  api/setup/route.ts    which provider is live
lib/
  x/                    url parsing, adapter chain, normalised SourcePost
  ai/                   models, zod schemas, prompts, deconstruct, variations, image
  originality.ts        different words  (+ .test.ts)
  fidelity.ts           same framework  (+ .test.ts)
  platforms/            every platform's formats, limits and validator (+ tests)
  mcp/
    server.ts           registration and the host-facing instructions
    state.ts            HMAC-signed multi-round-trip state
    tools/              source, guards, creative, memory, batch, orchestrate
  db/                   supabase client, swipe file queries
components/             primitives, OriginalCard, DnaPanel, VariationCard, BrandProfilePanel
```

The UI is built in the **Thought Pilot Console** system: one theme, frosted glass
panels on a toned canvas, monospace throughout, radius 0, emphasis by fill weight
rather than colour. Red means failure, amber means warning — the only two hues.
Tokens live on `:root` in `app/globals.css`, so retargeting one re-skins every
call site.

---

## Scope

Reads **public** posts and produces original derivative copy. The originality and
fidelity guards are the enforcement mechanism, and both are tested. Out of scope: reproducing anyone's
text verbatim, reusing their media, or generating creative that impersonates a brand.
