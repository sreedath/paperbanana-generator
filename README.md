# PaperBanana — web UI (v1)

One-click academic diagram generation, hosted at **paperbanana-generator.vizuara.ai**.
Pastel-academic styling is applied automatically using the Stylist/Visualizer prompts
ported from [llmsresearch/paperbanana](https://github.com/llmsresearch/paperbanana).

- **Model**: `gemini-3-pro-image-preview` (Google AI Studio), with fallback to
  `gemini-2.5-flash-image-preview` if unavailable.
- **Auth**: Google OAuth, restricted to an email allowlist
  (default: `rajatdandekar@vizuara.com`).
- **Stack**: Node 20+, Express, Passport, cookie-session.
- **Deploy target**: Vercel (serverless).

---

## Local run

```bash
cp .env.example .env        # fill in keys (OAuth creds, SESSION_SECRET, etc.)
npm install
npm start                   # http://localhost:3000
```

Required env vars:

| Var | Purpose |
|---|---|
| `GEMINI_API_KEY` | Google AI Studio key for image generation |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth client from Google Cloud Console |
| `PUBLIC_URL` | e.g. `https://paperbanana-generator.vizuara.ai` — used for OAuth callback |
| `ALLOWED_EMAILS` | comma-separated allowlist (default `rajatdandekar@vizuara.com`) |
| `SESSION_SECRET` | long random string (`openssl rand -hex 32`) |
| `PORT` | local dev only, default `3000` |
| `GEMINI_IMAGE_MODEL` | optional override, default `gemini-3-pro-image-preview` |

On Vercel, `PUBLIC_URL` auto-falls-back to `https://$VERCEL_URL` if not explicitly set.

---

## One-time Google OAuth setup

1. https://console.cloud.google.com/apis/credentials → Create OAuth 2.0 Client ID → **Web application**.
2. **Authorized JavaScript origins**:
   - `https://paperbanana-generator.vizuara.ai`
   - the Vercel preview URL (optional, for testing before the custom domain is attached)
3. **Authorized redirect URIs**:
   - `https://paperbanana-generator.vizuara.ai/auth/google/callback`
   - `https://<your-vercel-project>.vercel.app/auth/google/callback` (optional, for preview)
4. Copy the client ID + secret into `.env`.
5. On the OAuth consent screen, add `rajatdandekar@vizuara.com` as a test user
   if the app is still in "Testing" mode.

---

## Deploy to Vercel

### Requirements

- **Pro plan** (or higher) — Gemini image generation takes 15–40 s, and Hobby
  capped at 10 s. `vercel.json` requests `maxDuration: 60`.
- Vercel CLI installed: `npm i -g vercel`

### First-time setup

```bash
# 1. Log in (opens a browser, or use a token from https://vercel.com/account/tokens)
vercel login

# 2. Link this directory to a project (creates .vercel/)
cd "<this-repo>"
vercel link                 # accept or create project name "paperbanana-generator"

# 3. Push env vars to the production environment
vercel env add GEMINI_API_KEY            production
vercel env add GOOGLE_CLIENT_ID          production
vercel env add GOOGLE_CLIENT_SECRET      production
vercel env add SESSION_SECRET            production
vercel env add ALLOWED_EMAILS            production   # e.g. rajatdandekar@vizuara.com
vercel env add PUBLIC_URL                production   # https://paperbanana-generator.vizuara.ai
vercel env add GEMINI_IMAGE_MODEL        production   # (optional) gemini-3-pro-image-preview

# 4. Deploy
vercel --prod
```

### Attach the custom domain

```bash
vercel domains add paperbanana-generator.vizuara.ai
# Follow the DNS instructions Vercel prints (usually a CNAME to cname.vercel-dns.com
# on the vizuara.ai DNS provider).
```

Then **update the Google OAuth redirect URI** in Google Cloud Console to include
`https://paperbanana-generator.vizuara.ai/auth/google/callback` (if not already).

### Non-interactive / CI deploy

If you have a Vercel token (create at https://vercel.com/account/tokens):

```bash
export VERCEL_TOKEN=xxxxxxxx
vercel --prod --token "$VERCEL_TOKEN" --yes
```

---

## How it works (v1)

`src/prompts.js` wraps the user's description in PaperBanana's Visualizer
preamble + Stylist aesthetic guidelines before sending it to Gemini. No multi-agent
refinement loop yet — that's the v2 roadmap.

```
user input ──► buildImagePrompt()
                  │
                  ├─ Visualizer preamble (readable English labels, no titles)
                  ├─ Stylist guidelines (soft pastels, rounded rects, sans-serif)
                  └─ user description verbatim
                  ▼
            Gemini generateContent(responseModalities=["IMAGE"])
                  ▼
            base64 PNG/JPEG → browser preview + download
```

## Project layout

```
api/index.js         Vercel serverless entrypoint (wraps Express)
server.js            Local dev entrypoint (same app, app.listen())
src/app.js           Express app factory (shared by both entrypoints)
src/auth.js          Passport + Google OAuth + email allowlist
src/gemini.js        Gemini image-gen client with model fallback chain
src/prompts.js       PaperBanana Visualizer + Stylist prompt templates
public/              Static frontend (login.html, app.html, app.js, styles.css)
vercel.json          Routes everything to api/index, maxDuration: 60s
```

## v2 roadmap

- Multi-step pipeline (Planner → Stylist → Visualizer → Critic)
- Iterative refinement with VLM critique
- Reference diagram retrieval
- Venue presets (NeurIPS, ICML, ACL, IEEE)
- Slide deck mode
- Data-driven plot mode
