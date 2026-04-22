const express = require("express");
const { runPipeline } = require("./pipeline");
const { applyOverlay } = require("./overlay");
const { VALID_RATIOS, listImageModels, DEFAULT_IMAGE_MODEL } = require("./gemini");
const {
  listStyles, listTextDensities, listColorThemes,
  DEFAULT_STYLE, DEFAULT_TEXT_DENSITY, DEFAULT_COLOR_THEME,
} = require("./prompts");
const store = require("./store");
const {
  newKeyId, newJobId, mintKey, requireApiKey, requireAdmin, DEFAULT_DAILY_QUOTA,
} = require("./apiauth");

// Best-effort hook into Vercel's "run after response" extension.
let after = null;
try { after = require("@vercel/functions").after; } catch { /* optional */ }

function v1Router() {
  const router = express.Router();
  router.use(express.json({ limit: "8mb" }));

  // ---------- public: list capabilities (handy for clients) ----------
  router.get("/config", (_req, res) => {
    res.json({
      styles: listStyles(),
      text_densities: listTextDensities(),
      color_themes: listColorThemes(),
      aspect_ratios: VALID_RATIOS,
      image_models: listImageModels(),
      defaults: {
        style: DEFAULT_STYLE,
        text_density: DEFAULT_TEXT_DENSITY,
        color_theme: DEFAULT_COLOR_THEME,
        image_model: DEFAULT_IMAGE_MODEL,
      },
    });
  });

  // ---------- admin ----------
  router.post("/admin/keys", requireAdmin, async (req, res) => {
    const { name, daily_quota } = req.body || {};
    if (!name || typeof name !== "string") {
      return res.status(400).json({ error: { code: "invalid_request", message: "`name` is required (string)." } });
    }
    const { plaintext, hash } = mintKey();
    const meta = {
      id: newKeyId(),
      name: name.trim().slice(0, 80),
      hash,
      dailyQuota: Number.isFinite(daily_quota) ? Math.max(1, Math.min(10_000, daily_quota)) : DEFAULT_DAILY_QUOTA,
      createdAt: Date.now(),
      disabled: false,
    };
    await store.saveApiKey(meta);
    res.status(201).json({
      id: meta.id,
      name: meta.name,
      daily_quota: meta.dailyQuota,
      created_at: new Date(meta.createdAt).toISOString(),
      key: plaintext, // ⚠️ shown ONCE
      hint: "Save this key now — it cannot be retrieved later. Send as Authorization: Bearer <key>.",
    });
  });

  router.get("/admin/keys", requireAdmin, async (_req, res) => {
    const all = await store.listApiKeys();
    const today = new Date().toISOString().slice(0, 10);
    const out = [];
    for (const m of all) {
      const used = await store.getUsage(m.id, today);
      out.push({
        id: m.id,
        name: m.name,
        daily_quota: m.dailyQuota,
        used_today: used,
        created_at: new Date(m.createdAt).toISOString(),
        disabled: !!m.disabled,
      });
    }
    res.json({ keys: out, backend: store.backendKind() });
  });

  router.delete("/admin/keys/:id", requireAdmin, async (req, res) => {
    const meta = await store.getApiKey(req.params.id);
    if (!meta) return res.status(404).json({ error: { code: "not_found", message: "Key not found." } });
    await store.deleteApiKey(req.params.id);
    res.json({ id: req.params.id, deleted: true });
  });

  // ---------- helpers ----------
  function normaliseInput(body) {
    const {
      description, aspect_ratio, style, text_density, color_theme, model, iterations,
    } = body || {};
    if (!description || typeof description !== "string" || !description.trim()) {
      const e = new Error("`description` is required (non-empty string).");
      e.status = 400; e.code = "invalid_request";
      throw e;
    }
    const n = Math.min(Math.max(parseInt(iterations || 3, 10) || 3, 1), 3);
    return {
      description: description.trim(),
      aspectRatio: aspect_ratio || undefined,
      style: style || undefined,
      textDensity: text_density || undefined,
      colorTheme: color_theme || undefined,
      model: model || undefined,
      iterations: n,
    };
  }

  function serialiseIteration(it) {
    return {
      iteration: it.iteration,
      mime_type: it.image.mimeType,
      base64: it.image.base64,
      model: it.image.model,
      generation_ms: it.generationMs,
      critique: it.critique
        ? { notes: it.critique.notes, accept: !!it.critique.accept, model: it.critique.model }
        : null,
    };
  }

  // ---------- sync streaming: POST /v1/generate ----------
  router.post("/generate", requireApiKey, async (req, res) => {
    let params;
    try { params = normaliseInput(req.body); } catch (err) {
      return res.status(err.status || 400).json({ error: { code: err.code || "invalid_request", message: err.message } });
    }

    res.writeHead(200, {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      "transfer-encoding": "chunked",
      "x-paperbanana-key-id": req.apiKey.id,
    });
    if (typeof res.flushHeaders === "function") res.flushHeaders();

    const write = (obj) => {
      res.write(JSON.stringify(obj) + "\n");
      if (typeof res.flush === "function") res.flush();
    };

    write({
      type: "meta",
      iterations: params.iterations,
      style: params.style || DEFAULT_STYLE,
      text_density: params.textDensity || DEFAULT_TEXT_DENSITY,
      color_theme: params.colorTheme || DEFAULT_COLOR_THEME,
      aspect_ratio: params.aspectRatio || "auto",
      model: params.model || DEFAULT_IMAGE_MODEL,
    });

    try {
      await runPipeline({ ...params, onEvent: write });
      await store.incrementUsage(req.apiKey.id);
      res.end();
    } catch (err) {
      console.error("[v1 generate] failed:", err.message);
      write({ type: "error", error: err.message });
      res.end();
    }
  });

  // ---------- async: POST /v1/jobs, GET /v1/jobs/:id ----------
  router.post("/jobs", requireApiKey, async (req, res) => {
    let params;
    try { params = normaliseInput(req.body); } catch (err) {
      return res.status(err.status || 400).json({ error: { code: err.code || "invalid_request", message: err.message } });
    }

    const jobId = newJobId();
    const now = Date.now();
    const job = {
      id: jobId,
      keyId: req.apiKey.id,
      status: "queued",
      input: {
        description: params.description,
        iterations: params.iterations,
        aspect_ratio: params.aspectRatio || "auto",
        style: params.style || DEFAULT_STYLE,
        text_density: params.textDensity || DEFAULT_TEXT_DENSITY,
        color_theme: params.colorTheme || DEFAULT_COLOR_THEME,
        model: params.model || DEFAULT_IMAGE_MODEL,
      },
      progress: { iteration: 0, total: params.iterations, phase: "queued" },
      iterations: [],
      events: [],
      createdAt: now,
      completedAt: null,
      error: null,
    };
    await store.saveJob(job);

    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
    const statusUrl = `${proto}://${host}/v1/jobs/${jobId}`;

    res.status(202).json({
      job_id: jobId,
      status: "queued",
      status_url: statusUrl,
      created_at: new Date(now).toISOString(),
    });

    // Run the pipeline in the background. Vercel's `after()` keeps the function
    // alive up to maxDuration; locally the promise just runs inline.
    const runner = runJobPipeline(job, params);
    if (after) { try { after(runner); } catch { runner.catch(() => {}); } }
    else runner.catch(() => {});
  });

  async function runJobPipeline(job, params) {
    const jobId = job.id;
    try {
      job.status = "running";
      job.progress = { ...job.progress, phase: "running" };
      await store.saveJob(job);

      await runPipeline({
        ...params,
        onEvent: async (ev) => {
          try {
            if (ev.type === "gen:start") {
              job.progress = { iteration: ev.iteration, total: params.iterations, phase: `generating-${ev.iteration}` };
            } else if (ev.type === "gen:done") {
              job.iterations.push({
                iteration: ev.iteration,
                mime_type: ev.image.mimeType,
                base64: ev.image.base64,
                model: ev.image.model,
                generation_ms: ev.generationMs,
                critique: null,
              });
              job.progress = { iteration: ev.iteration, total: params.iterations, phase: `generated-${ev.iteration}` };
            } else if (ev.type === "critic:done") {
              const it = job.iterations.find((i) => i.iteration === ev.iteration);
              if (it) it.critique = { notes: ev.critique.notes, accept: !!ev.critique.accept, model: ev.critique.model };
              job.progress = { iteration: ev.iteration, total: params.iterations, phase: `critiqued-${ev.iteration}` };
            } else if (ev.type === "critic:error") {
              const it = job.iterations.find((i) => i.iteration === ev.iteration);
              if (it) it.critique = { notes: null, accept: false, error: ev.error };
            }
            await store.saveJob(job);
          } catch (e) {
            console.error("[job event save]", e.message);
          }
        },
      });

      job.status = "succeeded";
      job.completedAt = Date.now();
      job.progress = { iteration: params.iterations, total: params.iterations, phase: "succeeded" };
      await store.saveJob(job);
      await store.incrementUsage(job.keyId);
    } catch (err) {
      console.error(`[job ${jobId}] failed:`, err.message);
      job.status = "failed";
      job.error = { code: "pipeline_error", message: err.message };
      job.completedAt = Date.now();
      await store.saveJob(job);
    }
  }

  router.get("/jobs/:id", requireApiKey, async (req, res) => {
    const job = await store.getJob(req.params.id);
    if (!job || job.keyId !== req.apiKey.id) {
      return res.status(404).json({ error: { code: "not_found", message: "Job not found (may have expired after 24h)." } });
    }
    res.json({
      job_id: job.id,
      status: job.status,
      progress: job.progress,
      input: job.input,
      iterations: job.iterations,
      error: job.error,
      created_at: new Date(job.createdAt).toISOString(),
      completed_at: job.completedAt ? new Date(job.completedAt).toISOString() : null,
    });
  });

  router.get("/jobs", requireApiKey, async (req, res) => {
    const limit = Math.min(100, parseInt(req.query.limit || "20", 10) || 20);
    const jobs = await store.listJobsForKey(req.apiKey.id, limit);
    res.json({
      jobs: jobs.map((j) => ({
        job_id: j.id,
        status: j.status,
        created_at: new Date(j.createdAt).toISOString(),
        completed_at: j.completedAt ? new Date(j.completedAt).toISOString() : null,
      })),
    });
  });

  // ---------- overlay (post-processing) ----------
  // Accepts rich heading / url objects (font-family, size, color, bold/italic/underline,
  // position) plus a logo object (custom base64, size, position). Back-compat:
  // heading/url can also be plain strings.
  router.post("/overlay", requireApiKey, async (req, res) => {
    const { image_base64, heading, url, logo, show_logo } = req.body || {};
    if (!image_base64) {
      return res.status(400).json({ error: { code: "invalid_request", message: "`image_base64` is required." } });
    }
    try {
      const buf = Buffer.from(image_base64, "base64");
      const out = await applyOverlay({
        imageBuffer: buf,
        heading,
        url,
        logo,
        showLogo: !!show_logo,
      });
      res.json({
        mime_type: "image/png",
        base64: out.buffer.toString("base64"),
        width: out.width,
        height: out.height,
        used_logo_asset: out.hasLogoAsset,
      });
    } catch (err) {
      res.status(500).json({ error: { code: "overlay_failed", message: err.message } });
    }
  });

  return router;
}

module.exports = { v1Router };
