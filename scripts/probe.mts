import { fetchPost } from "../lib/x/fetch-post";
import { parseTweetUrl } from "../lib/x/parse-url";

const urls = [
  "https://x.com/yasser_elsaid_/status/1682818914923716609",
  "https://x.com/gregisenberg/status/1827692081109721502",
  "https://twitter.com/naval/status/1002103360646823936/photo/1?s=20",
  "not a link",
];

console.log("--- parse ---");
for (const u of urls) console.log(JSON.stringify(parseTweetUrl(u)), "<-", u.slice(0, 48));

console.log("\n--- fetch ---");
for (const u of urls.slice(0, 3)) {
  const r = await fetchPost(u);
  if (r.ok) {
    const p = r.post;
    console.log(`OK  @${p.author.handle} src=${p.source} media=${p.media.length} likes=${p.engagement.likes} replies=${p.engagement.replies} len=${p.text.length}`);
    console.log(`    media: ${p.media.map((m) => m.type + " " + m.url).join(", ") || "(none)"}`);
    console.log(`    text : ${JSON.stringify(p.text.slice(0, 100))}`);
  } else console.log("FAIL", r.reason, "-", r.message);
}
