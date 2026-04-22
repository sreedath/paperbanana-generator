// Storage abstraction: Upstash Redis in production, in-memory Map in local dev.
// Keys:
//   apikey:<keyId>           → { id, name, hash, dailyQuota, createdAt, disabled }
//   apikeys:index            → Set of keyIds
//   usage:<keyId>:<YYYY-MM-DD> → integer counter (auto-expires after 48h)
//   job:<jobId>              → { id, status, input, iterations, createdAt, completedAt, error } (TTL 24h)
//   jobs:<keyId>             → List of recent jobIds (capped at 50, TTL 24h)

const { Redis } = require("@upstash/redis");

const DAILY_USAGE_TTL = 60 * 60 * 48;       // 48h
const JOB_TTL = 60 * 60 * 24;               // 24h
const KEY_JOBS_LIMIT = 50;

let backend = null;

function inMemoryBackend() {
  const store = new Map();
  const sets = new Map();
  const lists = new Map();
  const ttls = new Map();

  function maybeExpire(key) {
    const exp = ttls.get(key);
    if (exp && exp < Date.now()) {
      store.delete(key); sets.delete(key); lists.delete(key); ttls.delete(key);
    }
  }
  return {
    async get(k) { maybeExpire(k); const v = store.get(k); return v === undefined ? null : v; },
    async set(k, v, opts = {}) {
      store.set(k, v);
      if (opts.ex) ttls.set(k, Date.now() + opts.ex * 1000);
    },
    async del(k) { store.delete(k); sets.delete(k); lists.delete(k); ttls.delete(k); },
    async incr(k) {
      maybeExpire(k);
      const cur = (store.get(k) || 0) + 1;
      store.set(k, cur);
      return cur;
    },
    async expire(k, seconds) { ttls.set(k, Date.now() + seconds * 1000); },
    async sadd(k, v) {
      let s = sets.get(k);
      if (!s) { s = new Set(); sets.set(k, s); }
      s.add(v);
    },
    async srem(k, v) { const s = sets.get(k); if (s) s.delete(v); },
    async smembers(k) { const s = sets.get(k); return s ? Array.from(s) : []; },
    async lpush(k, v) {
      let l = lists.get(k);
      if (!l) { l = []; lists.set(k, l); }
      l.unshift(v);
    },
    async ltrim(k, start, end) {
      const l = lists.get(k);
      if (!l) return;
      const s = start < 0 ? Math.max(0, l.length + start) : start;
      const e = end < 0 ? l.length + end : end;
      lists.set(k, l.slice(s, e + 1));
    },
    async lrange(k, start, end) {
      const l = lists.get(k) || [];
      const s = start < 0 ? Math.max(0, l.length + start) : start;
      const e = end < 0 ? l.length + end : end;
      return l.slice(s, e + 1);
    },
    isMemory: true,
  };
}

function upstashBackend() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const redis = new Redis({ url, token });
  return {
    name: "upstash",
    async get(k) { return await redis.get(k); },
    async set(k, v, opts = {}) {
      if (opts.ex) return await redis.set(k, v, { ex: opts.ex });
      return await redis.set(k, v);
    },
    async del(k) { return await redis.del(k); },
    async incr(k) { return await redis.incr(k); },
    async expire(k, seconds) { return await redis.expire(k, seconds); },
    async sadd(k, v) { return await redis.sadd(k, v); },
    async srem(k, v) { return await redis.srem(k, v); },
    async smembers(k) { return await redis.smembers(k); },
    async lpush(k, v) { return await redis.lpush(k, v); },
    async ltrim(k, start, end) { return await redis.ltrim(k, start, end); },
    async lrange(k, start, end) { return await redis.lrange(k, start, end); },
    isMemory: false,
  };
}

// Native Redis via TCP using ioredis. Used when REDIS_URL is set (Vercel
// Marketplace Redis, Redis Cloud, etc.). Works on Vercel Fluid Compute.
function nativeRedisBackend() {
  const url = process.env.REDIS_URL || process.env.KV_URL;
  if (!url) return null;
  const IORedis = require("ioredis");
  const client = new IORedis(url, {
    // Serverless-friendly: don't buffer indefinitely, connect lazily, retry sparingly.
    lazyConnect: false,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    connectTimeout: 5000,
    keepAlive: 15000,
  });
  client.on("error", (e) => console.warn("[store] ioredis error:", e.message));
  return {
    name: "native-redis",
    async get(k) { return await client.get(k); },
    async set(k, v, opts = {}) {
      const value = typeof v === "string" ? v : JSON.stringify(v);
      if (opts.ex) return await client.set(k, value, "EX", opts.ex);
      return await client.set(k, value);
    },
    async del(k) { return await client.del(k); },
    async incr(k) { return await client.incr(k); },
    async expire(k, seconds) { return await client.expire(k, seconds); },
    async sadd(k, v) { return await client.sadd(k, v); },
    async srem(k, v) { return await client.srem(k, v); },
    async smembers(k) { return await client.smembers(k); },
    async lpush(k, v) { return await client.lpush(k, v); },
    async ltrim(k, start, end) { return await client.ltrim(k, start, end); },
    async lrange(k, start, end) { return await client.lrange(k, start, end); },
    isMemory: false,
  };
}

function getBackend() {
  if (backend) return backend;
  backend = upstashBackend() || nativeRedisBackend();
  if (!backend) {
    console.warn("[store] no Redis configured (KV_REST_API_URL or REDIS_URL) — using in-memory store (DEV ONLY)");
    backend = inMemoryBackend();
    backend.name = "in-memory";
  }
  console.log(`[store] backend: ${backend.name}`);
  return backend;
}

function todayStamp() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
}

// ----- API keys -----
async function saveApiKey(meta) {
  const k = getBackend();
  await k.set(`apikey:${meta.id}`, JSON.stringify(meta));
  await k.sadd("apikeys:index", meta.id);
}
async function getApiKey(id) {
  const k = getBackend();
  const v = await k.get(`apikey:${id}`);
  if (!v) return null;
  return typeof v === "string" ? JSON.parse(v) : v;
}
async function listApiKeys() {
  const k = getBackend();
  const ids = await k.smembers("apikeys:index");
  const out = [];
  for (const id of ids) {
    const meta = await getApiKey(id);
    if (meta) out.push(meta);
  }
  return out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}
async function deleteApiKey(id) {
  const k = getBackend();
  await k.del(`apikey:${id}`);
  await k.srem("apikeys:index", id);
}

// ----- usage counters -----
async function incrementUsage(keyId) {
  const k = getBackend();
  const day = todayStamp();
  const count = await k.incr(`usage:${keyId}:${day}`);
  if (count === 1) await k.expire(`usage:${keyId}:${day}`, DAILY_USAGE_TTL);
  return count;
}
async function getUsage(keyId, day = todayStamp()) {
  const k = getBackend();
  const v = await k.get(`usage:${keyId}:${day}`);
  return parseInt(v || 0, 10) || 0;
}

// ----- jobs -----
async function saveJob(job) {
  const k = getBackend();
  await k.set(`job:${job.id}`, JSON.stringify(job), { ex: JOB_TTL });
  if (job.keyId) {
    await k.lpush(`jobs:${job.keyId}`, job.id);
    await k.ltrim(`jobs:${job.keyId}`, 0, KEY_JOBS_LIMIT - 1);
    await k.expire(`jobs:${job.keyId}`, JOB_TTL);
  }
}
async function getJob(id) {
  const k = getBackend();
  const v = await k.get(`job:${id}`);
  if (!v) return null;
  return typeof v === "string" ? JSON.parse(v) : v;
}
async function listJobsForKey(keyId, limit = 20) {
  const k = getBackend();
  const ids = await k.lrange(`jobs:${keyId}`, 0, limit - 1);
  const out = [];
  for (const id of ids) {
    const job = await getJob(id);
    if (job) out.push(job);
  }
  return out;
}

function backendKind() {
  return getBackend().name || (getBackend().isMemory ? "in-memory" : "upstash");
}

module.exports = {
  saveApiKey, getApiKey, listApiKeys, deleteApiKey,
  incrementUsage, getUsage,
  saveJob, getJob, listJobsForKey,
  backendKind,
};
