const path = require("path");
const express = require("express");
const cookieSession = require("cookie-session");
const passport = require("passport");

const { configurePassport, ensureAuthed } = require("./auth");
const { VALID_RATIOS, listImageModels, DEFAULT_IMAGE_MODEL } = require("./gemini");
const {
  listStyles, listTextDensities, listColorThemes,
  DEFAULT_STYLE, DEFAULT_TEXT_DENSITY, DEFAULT_COLOR_THEME,
} = require("./prompts");
const { runPipeline } = require("./pipeline");
const { applyOverlay } = require("./overlay");
const { v1Router } = require("./v1");

const PUBLIC_DIR = path.join(__dirname, "..", "public");

function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "1mb" }));

  app.use(
    cookieSession({
      name: "pb.sid",
      keys: [process.env.SESSION_SECRET || "dev-only-change-me"],
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    })
  );

  // passport + cookie-session compatibility: cookie-session doesn't implement
  // regenerate()/save() which newer passport versions expect.
  app.use((req, _res, next) => {
    if (req.session && typeof req.session.regenerate !== "function") {
      req.session.regenerate = (cb) => cb && cb();
    }
    if (req.session && typeof req.session.save !== "function") {
      req.session.save = (cb) => cb && cb();
    }
    next();
  });

  configurePassport();
  app.use(passport.initialize());
  app.use(passport.session());

  app.get("/healthz", (_req, res) => res.json({ ok: true }));

  // Public REST API (bearer-auth). Mounted before the static middleware and
  // before the session-gated routes so it needs no cookie.
  app.use("/v1", v1Router());

  // Serve public CSS/JS/images. HTML shells are just UI — API auth is the real gate.
  app.use(express.static(PUBLIC_DIR, { index: false, extensions: [] }));

  app.get("/login", (req, res) => {
    if (req.isAuthenticated && req.isAuthenticated()) return res.redirect("/");
    res.sendFile(path.join(PUBLIC_DIR, "login.html"));
  });

  // Public API docs (no auth).
  app.get("/docs", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "docs.html")));

  app.get(
    "/auth/google",
    passport.authenticate("google", { scope: ["profile", "email"], prompt: "select_account" })
  );

  app.get(
    "/auth/google/callback",
    passport.authenticate("google", { failureRedirect: "/login?denied=1" }),
    (_req, res) => res.redirect("/")
  );

  app.post("/auth/logout", (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      req.session = null;
      res.json({ ok: true });
    });
  });

  app.get("/api/me", ensureAuthed, (req, res) => {
    res.json({ email: req.user.email, displayName: req.user.displayName, photo: req.user.photo });
  });

  app.get("/api/config", ensureAuthed, (_req, res) => {
    res.json({
      aspectRatios: VALID_RATIOS,
      styles: listStyles(),
      textDensities: listTextDensities(),
      colorThemes: listColorThemes(),
      imageModels: listImageModels(),
      defaults: {
        style: DEFAULT_STYLE,
        textDensity: DEFAULT_TEXT_DENSITY,
        colorTheme: DEFAULT_COLOR_THEME,
        imageModel: DEFAULT_IMAGE_MODEL,
      },
    });
  });

  app.post("/api/generate", ensureAuthed, async (req, res) => {
    const { description, aspectRatio, style, textDensity, colorTheme, model, iterations } = req.body || {};
    if (!description || !String(description).trim()) {
      return res.status(400).json({ error: "description is required" });
    }
    const n = Math.min(Math.max(parseInt(iterations || 3, 10) || 3, 1), 3);

    // Stream NDJSON so the client renders each iteration as soon as it's ready.
    res.writeHead(200, {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      "transfer-encoding": "chunked",
    });
    if (typeof res.flushHeaders === "function") res.flushHeaders();

    const write = (obj) => {
      res.write(JSON.stringify(obj) + "\n");
      // Best-effort flush — some proxies need an explicit nudge.
      if (typeof res.flush === "function") res.flush();
    };

    write({
      type: "meta",
      aspectRatio: aspectRatio || "auto",
      style: style || DEFAULT_STYLE,
      textDensity: textDensity || DEFAULT_TEXT_DENSITY,
      colorTheme: colorTheme || DEFAULT_COLOR_THEME,
      model: model || DEFAULT_IMAGE_MODEL,
      iterations: n,
    });

    try {
      await runPipeline({
        description,
        aspectRatio,
        style,
        textDensity,
        colorTheme,
        model,
        iterations: n,
        onEvent: write,
      });
      res.end();
    } catch (err) {
      console.error("[generate] failed:", err.message);
      write({ type: "error", error: err.message });
      res.end();
    }
  });

  app.post("/api/overlay", ensureAuthed, async (req, res) => {
    const { imageBase64, mimeType, heading, showLogo, url } = req.body || {};
    if (!imageBase64) return res.status(400).json({ error: "imageBase64 is required" });
    try {
      const imageBuffer = Buffer.from(imageBase64, "base64");
      const out = await applyOverlay({
        imageBuffer,
        heading,
        showLogo: !!showLogo,
        url,
      });
      res.json({
        mimeType: "image/png",
        base64: out.buffer.toString("base64"),
        width: out.width,
        height: out.height,
        hasLogoAsset: out.hasLogoAsset,
      });
    } catch (err) {
      console.error("[overlay] failed:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/", ensureAuthed, (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "app.html"));
  });

  app.use((err, _req, res, _next) => {
    console.error("[unhandled]", err);
    res.status(500).json({ error: "internal_error" });
  });

  return app;
}

module.exports = { createApp };
