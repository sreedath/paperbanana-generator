# PaperBanana API — Admin Guide

How to mint, list, and revoke API keys for the PaperBanana generator.
This is for the workspace owner (Sreedath) and anyone else holding the
`ADMIN_TOKEN`. Teammates who just want to *use* the API should read
[API_GUIDE.md](./API_GUIDE.md) instead.

---

## 1. What the admin token is

A single server-side secret (`ADMIN_TOKEN` env var on Vercel) that authenticates
you against `/v1/admin/*` endpoints. It's shown **once** when you first set it,
and is not stored in this repo or in any of the public files.

**Store it** in 1Password / Bitwarden / a secrets manager — same way you'd store
a root AWS key. If you lose it, rotate it (§6 below).

> Throughout this doc, `$ADMIN_TOKEN` is your 64-character hex string.
> Everywhere you see it, substitute your real value — either export it to the
> shell once: `export ADMIN_TOKEN=<your-token>`, or prepend it per command.

---

## 2. Mint a new API key

```bash
curl -X POST https://paperbanana-generator.vizuara.ai/v1/admin/keys \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Rajat iPad tests",
    "daily_quota": 200
  }'
```

**Response:**
```json
{
  "id": "key_a1b2c3d4...",
  "name": "Rajat iPad tests",
  "daily_quota": 200,
  "created_at": "2026-04-22T11:30:00.000Z",
  "key": "pb_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "hint": "Save this key now — it cannot be retrieved later. Send as Authorization: Bearer <key>."
}
```

> ⚠️ **The `key` field is shown exactly once.** Only a SHA-256 hash is stored
> server-side. If the recipient loses it, revoke and mint a new one — you
> cannot recover the plaintext. Copy the key straight into the channel you'll
> send it through (password manager, 1Password sharing link, encrypted Slack
> DM) — don't paste it into a log file or an unencrypted email.

### Fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | ✓ | Human-readable label. Max 80 chars. Shown in admin list. |
| `daily_quota` | int | — | Max generations per UTC day (default 100, max 10 000). |

The `name` is there only for your own bookkeeping — it never has to match a
real person or email, and it's not exposed to the API caller.

---

## 3. List all keys + see today's usage

```bash
curl https://paperbanana-generator.vizuara.ai/v1/admin/keys \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Response:**
```json
{
  "keys": [
    {
      "id": "key_a1b2c3d4",
      "name": "Rajat iPad tests",
      "daily_quota": 200,
      "used_today": 47,
      "created_at": "2026-04-22T11:30:00.000Z",
      "disabled": false
    }
  ],
  "backend": "native-redis"
}
```

- `used_today` resets at 00:00 UTC and is the counter the `quota_exceeded`
  error checks against.
- `backend` tells you whether the server is hitting real Redis
  (`native-redis` / `upstash`) or an in-memory store (`in-memory` = dev-only,
  keys will not persist across cold starts).

Pipe to `jq` for prettier output:

```bash
curl -s https://paperbanana-generator.vizuara.ai/v1/admin/keys \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq '.keys[] | {name, used_today, daily_quota, id}'
```

---

## 4. Revoke a key

```bash
curl -X DELETE https://paperbanana-generator.vizuara.ai/v1/admin/keys/key_a1b2c3d4 \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Response:**
```json
{ "id": "key_a1b2c3d4", "deleted": true }
```

Effective immediately — the next request from that key returns `401
unauthenticated`. There's no recovery; you'd have to mint a new one.

---

## 5. Suggested workflow for onboarding a teammate

1. **Mint a key** with a descriptive `name` and a `daily_quota` matching their
   expected usage. Start lean (100–200/day) — you can always bump it by
   revoking + re-minting with a higher quota.
2. **Share the key securely.** In descending order of trustworthiness:
   - 1Password shared vault
   - Bitwarden Send (self-destructing link)
   - Signal / encrypted messaging
   - Slack DM (acceptable but not ideal)
   - **Never:** GitHub issues, public chats, unencrypted email, screenshots
3. **Point them at [API_GUIDE.md](./API_GUIDE.md)** for the endpoint reference
   and examples. That file intentionally contains a placeholder instead of a
   real key — they'll paste in the one you gave them.
4. **Bookmark the admin list URL** so you can spot runaway usage. Periodically:
   ```bash
   curl -s https://paperbanana-generator.vizuara.ai/v1/admin/keys \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     | jq '.keys | sort_by(-.used_today)'
   ```

---

## 6. Rotate the admin token (if it leaks)

If `ADMIN_TOKEN` is ever exposed — committed to git, screenshotted, leaked —
rotate it immediately:

```bash
# 1. Generate a new one
NEW=$(openssl rand -hex 32)
echo "$NEW"           # copy this to your password manager RIGHT NOW

# 2. Replace on Vercel (assumes vercel CLI is logged in + linked)
cd /path/to/paperbanana-generator
vercel env rm  ADMIN_TOKEN production --yes
printf "%s" "$NEW" | vercel env add ADMIN_TOKEN production
vercel --prod --yes     # redeploy so the new value takes effect
```

Existing user API keys (`pb_live_*`) are **not affected** by this rotation —
only the admin token changes. User keys are derived from their own plaintext
stored only as hashes; no admin change touches them.

If you're uncertain whether a *user* key is compromised, revoke it in §4.

---

## 7. Viewing stored keys directly (emergency / debugging)

The Redis backend stores:
- `apikeys:index` — Set of all key IDs
- `apikey:<keyId>` — JSON blob: `{ id, name, hash, dailyQuota, createdAt, disabled }`
- `usage:<keyId>:YYYY-MM-DD` — integer counter, auto-expires after 48 h
- `job:<jobId>` — user-submitted async job (TTL 24 h; keyed to a user key)
- `jobs:<keyId>` — list of recent job IDs for a key

If you need to poke around in Redis directly, use the Upstash/Redis console
from the Vercel **Storage** tab. **Hashes** are stored — never plaintext keys.

---

## 8. FAQ

**Q: I lost my admin token. What now?**
Rotate it per §6. As long as you still have Vercel CLI access to the project,
the old token can be replaced.

**Q: A teammate lost their API key. Can I resend it?**
No. Only a SHA-256 hash is stored server-side. Revoke the old key (§4) and
mint a new one (§2).

**Q: Can I set a *monthly* quota instead of daily?**
Not in v1. The counter rotates at 00:00 UTC daily. If you want a monthly cap,
either set daily quotas conservatively or open an issue — it's a small
extension to `src/store.js` and the quota check in `src/apiauth.js`.

**Q: What happens if someone burns their quota mid-iteration-loop?**
The check runs *before* any Gemini call, so an in-flight request can't be
interrupted. Their next request (after quota is reached) returns `429
quota_exceeded` with `reset_at: 00:00 UTC`.

**Q: Is there a free / anonymous tier?**
No — every `/v1/*` call requires a bearer token. `/v1/config` and `/docs`
are the only unauthenticated endpoints, and both are capability-discovery only
(they don't touch Gemini).

---

Last updated 2026-04-22.
