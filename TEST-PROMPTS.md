# Test prompts for the Ads-cloner connector

**How to use this file:** copy the text inside a grey box and paste it as a
message into your claude.ai chat — the one where **Ads-cloner** shows as
Enabled. Everything outside the boxes is explanation; you never copy that.

Only these boxes get pasted. `clone_ad`, `write_variations` and `deconstruct_ad`
are a different thing — they are *MCP prompts* stored on the server, and Claude
reaches for them itself.

Server: `https://adclone-studio.onrender.com/mcp`

---

## 1. Start here — the whole pipeline in one message

```
Clone this ad with Ads-cloner: https://x.com/gregisenberg/status/1827692081109721502

Pick the format that fits it and say why. Write three angles. Verify every one with check_clone — pass the fields, not a joined string — and revise what it flags. Generate one creative. Save it and give me the link.

Show me a table of angle, originality, fidelity, spec, and the image frame you actually got.
```

That URL is a 36-item listicle, which is the hardest case for every guard. It is
re-verified as fetchable.

**Expect:** a format choice with a reason, three variations, originality and
fidelity numbers from `check_clone`, one image, and a library link.

---

## 2. The two formats nobody has run yet

Same as above with the target changed. These are the most likely to break.

```
Clone this ad with Ads-cloner as a Meta story: https://x.com/gregisenberg/status/1827692081109721502

Verify with check_clone passing the fields. Generate the creative with a model that honours dimensions, and tell me the frame you actually got back.
```

The only 9:16 format, and its `overlayText` field has never been through the
pipeline.

```
Clone this ad with Ads-cloner as a Google responsive search ad: https://x.com/gregisenberg/status/1827692081109721502

Fifteen headlines at 30 characters, two descriptions. Verify with check_clone. There is no creative for this format — say so rather than generating one.
```

Pure text, every asset has to stand alone. A completely different writing
problem from the other three.

---

## 3. All four platforms in one run

```
Clone this ad across all four ad platforms using Ads-cloner, three angles each, with creatives.

https://x.com/gregisenberg/status/1827692081109721502

Do it in this order and show your working:

1. fetch_ad — read the copy and look at the creative. Tell me what the image DOES, not just what it shows.

2. Deconstruct the framework once. Hook type, beat order, formatting habits, audience, persuasion triggers, and the visual's job.

3. get_platform_spec with no arguments. For each of X, LinkedIn, Meta and Google, pick the format whose shape actually fits a 36-item listicle and tell me why. Do not default to the single-image layout without a reason.

4. get_reference_ads with the source's hook type, as calibration. An empty result is fine — say so and move on.

5. For each platform, write three variations: direct-swap, aggressive, minimalist. Use the write_variations prompt with that platform AND format so you get the real field structure.

6. Verify every variation with check_clone — pass platform, format and the FIELDS you wrote, never a string you joined yourself. Then check_convergence per platform. Revise what it names and re-check.

   A drift note saying the format is the constraint is not yours to fix. Say which those are and leave them.

7. Creatives. Call list_image_models first. Then generate ONE creative per variation — for a carousel, card one only — and stop there so we stay inside the daily budget. Use a model that honours dimensions where the frame shape matters. Report the frame you actually got back each time. Google's search ad has no creative; skip it and say so.

8. save_swipe each platform's run with its reports and creatives, and give me the library links.

Finish with a table: platform, format, angle, originality, fidelity, spec, and whether the creative's frame was right. Say plainly anything that could not be made to pass.
```

Costs roughly **9 images** — three each for X, LinkedIn and Meta, none for
Google's search ad. Step 7 caps carousels at card one on purpose: all ten cards
across three angles is 30 images for LinkedIn alone, and you cannot tell whether
the approach is right until you have seen one.

---

## 4. Checking one thing at a time

### Is the connector serving the current build?

```
List every tool the Ads-cloner connector exposes, with a one-line description each.
```

**Expect 22.** If you see 18, the client cached an old tool list — reconnect it.

### Does it fetch a real ad in full?

```
Use Ads-cloner to fetch this ad and describe what the creative actually does, not just what it shows: https://x.com/gregisenberg/status/1827692081109721502
```

**Expect ~2,765 characters** of copy plus an image it comments on. If you get
~276 characters it took a truncated path.

### The two-axis guard — the most important single check

```
Run check_clone on this pair.

ORIGINAL:
I audited 250 SaaS landing pages this month.

71% failed in the first five seconds.

- Lead with the result
- Cut every adjective
- Put the proof above the fold

Full breakdown, no email needed. Link below.

CANDIDATE:
Have you ever wondered why your onboarding underperforms? Most teams assume the answer lies somewhere in their messaging, and they spend weeks rewriting it, which is understandable given how much attention copy receives, but it rarely turns out to be where the problem actually lives.
```

**Expect originality ~95 PASS and fidelity ~19 FAIL**, with the drift named in
five specific lines. This is the gap that existed before the fidelity guard — if
fidelity comes back passing, something is wrong.

### Does group validation work?

```
Validate a Meta carousel with intro text "Five things nobody tells you about checkout." and just one card titled "Fine".
```

**Expect:** `Cards: 1 supplied, needs 2–10.`

### Does a blocked platform ask rather than fail?

```
Fetch this LinkedIn ad with Ads-cloner: https://www.linkedin.com/ad-library/detail/123456789
```

**Expect it to ask you to paste the copy.** Paste any ad text and it should
carry on as though it had fetched it.

### Does the playbook refuse to invent patterns?

```
What patterns does my Ads-cloner playbook show?
```

Below about 8 saved ads it should **decline to claim a pattern**. Confident
findings from three ads would be a bug.

### Convergence — the failure that wastes a batch

```
Write three variations of that ad with Ads-cloner, then check them against EACH OTHER, not the source.
```

Three near-paraphrases should be flagged.

---

## 5. Images

```
Use Ads-cloner to generate an ad creative: a vertical phone screenshot of a plain notes app on a deep charcoal background, one short legible line reading "step two lost them", the rest as smaller non-legible body text, soft top-down light. Avoid stock photos, desks, laptops and watermarks. Aspect 9:16, and use a model that honours dimensions. Tell me which frame actually came back.
```

**Expect 576×1024.** If it says "written as a square 1024×1024" it used the
default model — ask it to re-render with `sdxl`.

Three things that will bite you:

- **The default model always writes a square.** `flux-1-schnell` composes for the
  aspect you ask for and returns 1024×1024 regardless. Say "use a model that
  honours dimensions" whenever the file shape matters.
- **Text in images:** ask for **one short line, in quotes, under about eight
  words.** Both models garble anything longer. Describe the rest as
  "further lines of smaller body text, not legible".
- **~190 images a day**, shared across both models. Over the ceiling you get a
  readable quota error, not a crash.

### Cloning a visual's mechanism, which is the part that matters

```
Use Ads-cloner on https://x.com/gregisenberg/status/1827692081109721502

Look at the creative and tell me what job it does — proof, pattern-interrupt, contrast, punchline, credibility — and whether its FORMAT is the mechanism.

Then write an image prompt that keeps that job and that compositional relationship, but changes the palette, subject, setting and every word shown. If it works because it looks like an organic screenshot, clone it as a DIFFERENT screenshot, not as a polished illustration.

Call list_image_models, pick appropriately, render it, and tell me in one clause what the original visual did that yours reproduces.
```

A good result names the mechanism *before* writing the prompt, and the render is
not a generic desk-and-laptop scene.

---

## 6. Run these last

```
Create an Ads-cloner batch from these 3 X URLs.
```

Needs `GOOGLE_GENERATIVE_AI_API_KEY`, which has been hitting free-tier quota
limits. Per-item rate-limit errors are readable failures, not crashes.

**`delete_swipe` is destructive and cannot be undone.** Test it on something you
do not mind losing.

---

## Known limits, so a result does not look like a bug

- **`clone_ad_auto` will not run its loop on claude.ai.** That connection cannot
  carry a sampling round, so the tool returns `mode: "guided"` with the full
  brief and a `why` field. That is correct behaviour, not a failure — the host
  drives the loop instead. Every other tool works identically either way.
- **Neither image model accepts image input**, so the original creative cannot
  be handed to the renderer. Style has to be carried in words.
- **A 36-item source produces a ceiling note on every format.** Expect *"you are
  at the ceiling, so the remaining gap is the format's cost, not a fault in the
  draft."* An unqualified *"yours lists 10"* would mean a fix did not take.
- **The web app has no auth.** `adclone-studio.onrender.com`, `/api/*` and
  `/library` are open to anyone with the URL. The bearer token covers `/mcp`
  only.
