const crypto = require("crypto");
const store = require("./store");

const KEY_PREFIX = "pb_live_";
const KEY_ENTROPY_BYTES = 24; // → 32 base64url chars
const DEFAULT_DAILY_QUOTA = 100;

function newKeyId() {
  return "key_" + crypto.randomBytes(8).toString("hex");
}
function newJobId() {
  return "job_" + crypto.randomBytes(12).toString("hex");
}

function mintKey() {
  const raw = crypto.randomBytes(KEY_ENTROPY_BYTES).toString("base64url");
  const plaintext = KEY_PREFIX + raw;
  const hash = crypto.createHash("sha256").update(plaintext).digest("hex");
  return { plaintext, hash };
}

function hashKey(plaintext) {
  return crypto.createHash("sha256").update(plaintext).digest("hex");
}

function timingSafeEq(a, b) {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function extractBearer(req) {
  const h = req.headers.authorization || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

// ----- API key auth for /v1/* (non-admin) routes -----
async function requireApiKey(req, res, next) {
  const token = extractBearer(req);
  if (!token || !token.startsWith(KEY_PREFIX)) {
    return res.status(401).json({
      error: {
        code: "unauthenticated",
        message: "Missing or malformed bearer token. Send Authorization: Bearer pb_live_...",
      },
    });
  }

  const providedHash = hashKey(token);

  // Find the key by scanning — for a small set this is fine, and indexing by
  // hash keeps it O(1) lookup via direct get.
  const meta = await store.getApiKey(providedHash);
  let found = null;
  if (meta && timingSafeEq(meta.hash, providedHash)) {
    found = meta;
  } else {
    // Fallback: the key is stored keyed by its own id, not its hash. Do a list
    // scan. This runs only on misses; in practice the first path hits.
    const all = await store.listApiKeys();
    for (const m of all) {
      if (timingSafeEq(m.hash, providedHash)) { found = m; break; }
    }
  }
  if (!found || found.disabled) {
    return res.status(401).json({
      error: { code: "unauthenticated", message: "Invalid or disabled API key." },
    });
  }

  // Enforce daily quota.
  const used = await store.getUsage(found.id);
  const quota = Number.isFinite(found.dailyQuota) ? found.dailyQuota : DEFAULT_DAILY_QUOTA;
  if (used >= quota) {
    return res.status(429).json({
      error: {
        code: "quota_exceeded",
        message: `Daily quota of ${quota} requests reached. Resets at 00:00 UTC.`,
        used,
        quota,
      },
    });
  }

  req.apiKey = found;
  req.apiKeyUsed = used;
  next();
}

// ----- admin token auth for /v1/admin/* -----
function requireAdmin(req, res, next) {
  const token = extractBearer(req);
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) {
    return res.status(500).json({
      error: { code: "admin_not_configured", message: "ADMIN_TOKEN env var is not set on the server." },
    });
  }
  if (!token || !timingSafeEq(token, adminToken)) {
    return res.status(401).json({
      error: { code: "unauthenticated", message: "Admin token required. Send Authorization: Bearer <ADMIN_TOKEN>." },
    });
  }
  next();
}

module.exports = {
  newKeyId,
  newJobId,
  mintKey,
  hashKey,
  requireApiKey,
  requireAdmin,
  DEFAULT_DAILY_QUOTA,
  KEY_PREFIX,
};
