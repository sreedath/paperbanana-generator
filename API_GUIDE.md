# PaperBanana API — Team Guide

Programmatic access to the PaperBanana academic-diagram generator at
https://paperbanana-generator.vizuara.ai/. Same pipeline, same styling options,
same Gemini models as the web UI — exposed over a simple bearer-authenticated
REST API.

---

## 1. Your API key

```
pb_live_YOUR_TEAM_KEY_HERE
```

> **The real key is not in this file.** Sreedath will share it separately (1Password, Slack DM, encrypted channel). Paste it in place of `pb_live_YOUR_TEAM_KEY_HERE` in the examples below, or export it once:
>
> ```bash
> export PB_KEY=pb_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
> ```

Send it on every request:

```
Authorization: Bearer $PB_KEY
```

> Keep the key out of git repos and public code. Rotate by asking the workspace
> owner (Sreedath) to revoke and mint a new one — see [ADMIN_GUIDE.md](./ADMIN_GUIDE.md).

---

## 2. Base URL

```
https://paperbanana-generator.vizuara.ai/v1
```

Browsable HTML version of these docs: https://paperbanana-generator.vizuara.ai/docs

---

## 3. Quick start (60 seconds)

```bash
export PB_KEY=pb_live_YOUR_TEAM_KEY_HERE

# Generate one iteration (fastest, ~25 s), stream progress to stdout
curl -N -X POST https://paperbanana-generator.vizuara.ai/v1/generate \
  -H "Authorization: Bearer $PB_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "description": "A left-to-right transformer pipeline: tokenizer, positional encoding, 6 stacked encoder blocks, decoder with masked self-attention, softmax output. Pastel colors.",
    "iterations": 1,
    "aspect_ratio": "16:9"
  }'
```

Each line in the response is a JSON event (NDJSON). The `gen:done` event
contains your image as `image.base64` (a base64-encoded PNG/JPEG). Decode and
save.

---

## 4. Feature parity — the web UI vs the API

| Web UI control | API parameter | Notes |
|---|---|---|
| Description textarea | `description` | required, non-empty string |
| Iterations dropdown (1 / 2 / 3) | `iterations` | int 1–3, default 3 |
| Style preset (6 options) | `style` | see §6 |
| Text density (4 options) | `text_density` | see §6 |
| Color theme (13 palettes) | `color_theme` | see §6 |
| Aspect ratio | `aspect_ratio` | `"1:1"`, `"2:3"`, `"3:2"`, `"3:4"`, `"4:3"`, `"9:16"`, `"16:9"`, `"21:9"` |
| Image model picker | `model` | see §6 |
| Critic loop (Gemini 2.5 Flash VLM) | automatic | runs between iterations; notes returned per iteration |
| 3-image grid live streaming | `POST /v1/generate` (NDJSON) | same event stream the web UI consumes |
| 3-image progress bar with partial results | `POST /v1/jobs` + `GET /v1/jobs/:id` | async alternative with polling |
| Overlay: heading, logo, URL | `POST /v1/overlay` | font family / size / color / bold / italic / underline / position |
| Custom logo upload | `logo.base64` in `/v1/overlay` | base64-encoded PNG/JPEG |
| Session persistence (localStorage) | — client concern; the API is stateless. You keep the base64 in your own storage. |
| Backup export/import | — just serialize the API response on your side |

---

## 5. Discover capabilities

```bash
curl https://paperbanana-generator.vizuara.ai/v1/config
```

Returns the full authoritative list of `styles`, `text_densities`, `color_themes`,
`aspect_ratios`, `image_models`, plus the server's current defaults. No auth
required — use this to keep clients in sync when options change.

---

## 6. Generation parameters

### `style`
- `default` — PaperBanana pastel academic (default)
- `research-paper` — NeurIPS/ICML camera-ready, grayscale-leaning
- `presentation` — bold, vivid, built for projection
- `minimalist` — monochrome/duotone, lots of whitespace
- `hand-drawn` — sketchy whiteboard marker feel
- `dark` — dark background, saturated neon accents

### `text_density`
- `standard` (default)
- `minimal` — key labels only
- `light` — labels + brief captions
- `dense` — full annotations + math notation

### `color_theme`
- `default` — whatever the style preset dictates (no override)
- `ocean` · `sunset` · `forest` · `lavender` · `nordic` · `earth` · `berry` · `mint` · `autumn` · `candy` · `mono-blue` · `mono-gray`

### `model`
- `auto` (default) — Gemini 3 Pro Image with automatic fallback to Flash Image on overload
- `gemini-3-pro-image-preview` — force Pro (highest quality, can be busy)
- `gemini-2.5-flash-image-preview` — force Flash (faster, usually available)
- `gemini-2.5-flash-image` — GA variant of Flash

---

## 7. Endpoints

### `POST /v1/generate` — streaming (sync)

Runs the full pipeline and streams NDJSON events as they happen. Good for
interactive clients (CLI, notebooks) and for keeping round-trip simple.

**Body:**
```json
{
  "description": "<required, non-empty>",
  "iterations": 3,
  "style": "research-paper",
  "text_density": "dense",
  "color_theme": "ocean",
  "aspect_ratio": "16:9",
  "model": "auto"
}
```

**Response stream** (one JSON object per line):
```
{"type":"meta","iterations":3,"style":"research-paper",...}
{"type":"gen:start","iteration":1}
{"type":"gen:done","iteration":1,"image":{"mimeType":"image/png","base64":"...","model":"gemini-3-pro-image-preview"},"generationMs":24182}
{"type":"critic:start","iteration":1}
{"type":"critic:done","iteration":1,"critique":{"notes":"...","accept":false,"model":"gemini-2.5-flash"},"critiqueMs":6142}
{"type":"gen:start","iteration":2}
{"type":"gen:done","iteration":2, ...}
{"type":"critic:done","iteration":2, ...}
{"type":"gen:start","iteration":3}
{"type":"gen:done","iteration":3, ...}
{"type":"done","totalMs":85210}
```

If anything fails mid-stream: `{"type":"error","error":"..."}`. Whatever images
arrived before the error are still valid.

### `POST /v1/jobs` — async

Returns a job id immediately, runs the pipeline in the background. Best for
web-backend → API integrations where you don't want to hold an HTTP connection
open for 90 s.

**Request:** same body as `/v1/generate`.

**Response:** `202 Accepted`
```json
{
  "job_id": "job_abc123...",
  "status": "queued",
  "status_url": "https://paperbanana-generator.vizuara.ai/v1/jobs/job_abc123...",
  "created_at": "2026-04-22T03:21:18.026Z"
}
```

### `GET /v1/jobs/:id`

Poll the job. Typical response fields:

```json
{
  "job_id": "job_abc...",
  "status": "running",                // queued | running | succeeded | failed
  "progress": { "iteration": 2, "total": 3, "phase": "generating-2" },
  "input": { "description": "...", "iterations": 3, ... },
  "iterations": [
    {
      "iteration": 1,
      "mime_type": "image/png",
      "base64": "<long>",
      "model": "gemini-3-pro-image-preview",
      "generation_ms": 24182,
      "critique": { "notes": "...", "accept": false, "model": "gemini-2.5-flash" }
    }
  ],
  "error": null,
  "created_at": "...",
  "completed_at": null
}
```

Jobs expire 24 h after creation. Poll every 2–5 seconds; completed `iterations`
accumulate in the array as they finish, so you can render partial results
without waiting for the final one.

### `GET /v1/jobs?limit=20`

List your key's recent jobs (status + timestamps, no image bytes).

### `POST /v1/overlay` — composite a heading / logo / URL

All overlays are optional. Send any combination. Positions can be absolute
pixels (`x`, `y` from top-left) or named (`top-left`, `top-center`, `top-right`,
`center`, `bottom-left`, `bottom-center`, `bottom-right`).

**Request body:**
```json
{
  "image_base64": "<base64 PNG from an earlier /v1/generate response>",
  "heading": {
    "text": "Figure 1: Transformer architecture",
    "font_family": "Arial",
    "font_size": 72,
    "color": "#1f2330",
    "bold": true,
    "italic": false,
    "underline": false,
    "position": "top-left"
  },
  "url": {
    "text": "vizuara.ai",
    "font_family": "Georgia",
    "font_size": 32,
    "color": "#1f2330",
    "italic": true,
    "position": "bottom-right"
  },
  "show_logo": true,
  "logo": {
    "size": 96,
    "position": "bottom-left"
  }
}
```

**Shortcut form** (backwards compatible): pass `heading` and/or `url` as a
plain string; defaults will be chosen automatically.

**Custom logo**: send `logo.base64` with your own PNG/JPEG (base64-encoded) to
override the default Vizuara logo. Otherwise the built-in logo is used when
`show_logo: true`.

**Response:**
```json
{
  "mime_type": "image/png",
  "base64": "<composited PNG>",
  "width": 1792,
  "height": 1024,
  "used_logo_asset": true
}
```

> Font caveat: the server-side renderer uses the Vercel runtime's system fonts.
> Common fallbacks (`sans-serif`, `serif`, `monospace`, `Arial`, `Helvetica`,
> `Georgia`, `Times New Roman`, `Courier New`) render predictably. Branded
> Google Fonts used in the web UI (Inter, Montserrat, Playfair Display, etc.)
> will substitute to the generic `sans-serif` / `serif` family. If you need
> pixel-perfect Google-Font output, render the image with the API, download,
> and compose in the web UI (which uses browser fonts) — or do your own
> client-side compositing.

---

## 8. Rate limits & quotas

- **500 generations / UTC day** for the "Vizuara team" key above.
- Quota is consumed on successful `/v1/generate` streams or `/v1/jobs` completions.
- When exhausted: `429` with `error.code = "quota_exceeded"`.
- Resets at 00:00 UTC.
- `/v1/overlay` and `/v1/config` do not count against the quota.

---

## 9. Error shape

Every error response (regardless of endpoint) has this shape:

```json
{
  "error": {
    "code": "quota_exceeded",
    "message": "Daily quota of 500 requests reached. Resets at 00:00 UTC.",
    "used": 500,
    "quota": 500
  }
}
```

**Codes**: `unauthenticated`, `quota_exceeded`, `invalid_request`, `not_found`,
`overlay_failed`, `pipeline_error`.

Pipeline errors include Gemini's own status when relevant, e.g.
`"UNAVAILABLE This model is currently experiencing high demand."` — the server
already retries 3× with exponential backoff before surfacing this, and in
`model: "auto"` mode it cross-falls-back to the Flash model automatically.

---

## 10. Full examples

### curl — sync streaming, 3 iterations, save each image as it arrives

```bash
export PB_KEY=pb_live_YOUR_TEAM_KEY_HERE

curl -N -X POST https://paperbanana-generator.vizuara.ai/v1/generate \
  -H "Authorization: Bearer $PB_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "description": "U-Net segmentation architecture with skip connections and bottleneck features",
    "iterations": 3,
    "style": "research-paper",
    "color_theme": "nordic",
    "aspect_ratio": "16:9"
  }' | while IFS= read -r line; do
    type=$(echo "$line" | jq -r .type)
    if [ "$type" = "gen:done" ]; then
      iter=$(echo "$line" | jq -r .iteration)
      echo "$line" | jq -r .image.base64 | base64 -d > "iter-$iter.png"
      echo "saved iter-$iter.png"
    fi
  done
```

### Python — async with polling

```python
import os, time, base64, requests

BASE = "https://paperbanana-generator.vizuara.ai/v1"
H = {"Authorization": f"Bearer {os.environ['PB_KEY']}"}

payload = {
    "description": "Retrieval-augmented generation pipeline with a vector store, reranker, and LLM reader.",
    "iterations": 3,
    "style": "presentation",
    "color_theme": "berry",
    "aspect_ratio": "16:9",
    "model": "auto",
}

r = requests.post(f"{BASE}/jobs", headers=H, json=payload)
r.raise_for_status()
job_id = r.json()["job_id"]
print("job:", job_id)

while True:
    job = requests.get(f"{BASE}/jobs/{job_id}", headers=H).json()
    print(job["status"], job.get("progress"))
    if job["status"] in ("succeeded", "failed"):
        break
    time.sleep(3)

if job["status"] == "failed":
    raise RuntimeError(job["error"])

for it in job["iterations"]:
    with open(f"iter-{it['iteration']}.png", "wb") as f:
        f.write(base64.b64decode(it["base64"]))
    print(f"saved iter-{it['iteration']}.png"
          + (f"  critique: {it['critique']['notes'][:80]}" if it.get('critique') else ""))
```

### Python — generate + overlay in one script

```python
import os, base64, requests

BASE = "https://paperbanana-generator.vizuara.ai/v1"
H = {"Authorization": f"Bearer {os.environ['PB_KEY']}"}

# 1. generate
r = requests.post(f"{BASE}/jobs", headers=H, json={
    "description": "Two-tower recommendation model with dot-product scoring",
    "iterations": 1,   # single shot → faster when you don't need critic refinement
})
job_id = r.json()["job_id"]

import time
while (job := requests.get(f"{BASE}/jobs/{job_id}", headers=H).json())["status"] not in ("succeeded", "failed"):
    time.sleep(3)

img_b64 = job["iterations"][0]["base64"]

# 2. overlay heading + logo + url
r = requests.post(f"{BASE}/overlay", headers=H, json={
    "image_base64": img_b64,
    "heading": {
        "text": "Figure 3: Two-tower recommender",
        "font_size": 72,
        "bold": True,
        "position": "top-left",
    },
    "show_logo": True,
    "logo": {"size": 96, "position": "bottom-left"},
    "url": {"text": "vizuara.ai", "font_size": 32, "italic": True, "position": "bottom-right"},
})
with open("final.png", "wb") as f:
    f.write(base64.b64decode(r.json()["base64"]))
print("wrote final.png")
```

### Node — streaming sync, save each image

```js
import fs from "node:fs";

const res = await fetch("https://paperbanana-generator.vizuara.ai/v1/generate", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${process.env.PB_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    description: "Data lakehouse architecture with bronze/silver/gold layers",
    iterations: 3,
    style: "presentation",
    color_theme: "ocean",
  }),
});

const reader = res.body.getReader();
const decoder = new TextDecoder();
let buf = "";
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += decoder.decode(value, { stream: true });
  const lines = buf.split("\n");
  buf = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    const ev = JSON.parse(line);
    if (ev.type === "gen:done") {
      fs.writeFileSync(`iter-${ev.iteration}.png`,
        Buffer.from(ev.image.base64, "base64"));
      console.log(`saved iter-${ev.iteration}.png`);
    }
  }
}
```

---

## 11. FAQ

**Q: How is this different from calling Gemini directly?**
A: PaperBanana bakes in academic-figure prompting (Visualizer + Stylist from
the NeurIPS / ICML upstream) and adds a VLM critic that refines the description
between iterations. You get 3 progressively-better images instead of one raw
Gemini output, plus consistent pastel-academic styling by default.

**Q: Can I generate without iterations?**
A: Pass `"iterations": 1` for a single-shot call (~25 s, no critique loop).

**Q: How big are the returned images?**
A: Gemini's current default is ~1K on the longer side (~300–400 KB per
base64-encoded image). Exact dimensions vary by aspect ratio.

**Q: Sync or async — which should I use?**
A: If your caller can hold a 90-second streaming HTTP connection
(notebook, CLI, server-side batch job), use `/v1/generate` — you get
progress events as iterations finish. Otherwise use `/v1/jobs` and poll.

**Q: What happens if Gemini returns `UNAVAILABLE`?**
A: In `model: "auto"` (default), the server retries 3× with exponential
backoff on the Pro model, then automatically falls back to Flash. You
almost never need to worry about it. If you specified a model explicitly,
only retries run — no fallback — and the error surfaces after retries exhaust.

**Q: Where does my image data live server-side?**
A: Images in async jobs live in Redis for 24 hours, then expire. Sync
streaming never stores anything. The server does not log your descriptions.

**Q: Can the critic notes be returned separately?**
A: They're already part of every `gen:done` event's downstream `critic:done`,
and included inline in the async job's `iterations[].critique` field.

---

Last updated 2026-04-22. Questions → Sreedath.
