const { GoogleGenAI } = require("@google/genai");
const { buildImagePrompt } = require("./prompts");

const DEFAULT_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-3-pro-image-preview";
const FALLBACK_MODELS = [
  "gemini-3-pro-image-preview",
  "gemini-2.5-flash-image-preview",
  "gemini-2.5-flash-image",
];

// User-facing image model catalogue. `auto` is the default and walks the
// fallback chain above if a model returns UNAVAILABLE/INTERNAL after retries.
const IMAGE_MODELS = [
  {
    value: "auto",
    label: "Auto — try Gemini 3 Pro, fall back on overload",
    id: null,
  },
  {
    value: "gemini-3-pro-image-preview",
    label: "Gemini 3 Pro Image (highest quality, can be busy)",
    id: "gemini-3-pro-image-preview",
  },
  {
    value: "gemini-2.5-flash-image-preview",
    label: "Gemini 2.5 Flash Image (faster, usually available)",
    id: "gemini-2.5-flash-image-preview",
  },
  {
    value: "gemini-2.5-flash-image",
    label: "Gemini 2.5 Flash Image (GA variant)",
    id: "gemini-2.5-flash-image",
  },
];
const DEFAULT_IMAGE_MODEL = "auto";

function listImageModels() {
  return IMAGE_MODELS.map(({ value, label }) => ({ value, label }));
}

let client = null;
function getClient() {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

const VALID_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"];

// Classification of Gemini errors:
//   - "fallback": this model can't serve the request — try a different model.
//   - "transient": the model is fine, just retry with backoff.
//   - "fatal": bad request / auth / content — don't retry, don't fall back.
function classifyError(msg) {
  const m = String(msg || "");
  if (/NOT_FOUND|not found|is not supported|does not support|UNSUPPORTED|PERMISSION_DENIED|model is not/i.test(m)) {
    return "fallback";
  }
  if (/INTERNAL|UNAVAILABLE|RESOURCE_EXHAUSTED|DEADLINE_EXCEEDED|ABORTED|\b5\d{2}\b|\b429\b|fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up/i.test(m)) {
    return "transient";
  }
  return "fatal";
}

// Extract the short "message" field out of Gemini's JSON error dumps so
// user-facing status lines are readable.
function cleanErrorMessage(err) {
  const raw = err?.message || String(err || "unknown error");
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      const code = parsed?.error?.status || parsed?.error?.code;
      const message = parsed?.error?.message;
      if (code || message) return `${code || ""} ${message || ""}`.trim();
    }
  } catch {}
  return raw;
}

/**
 * Call a single Gemini image model ONCE. Returns { mimeType, base64 } on success,
 * or throws.
 */
async function callModel(model, prompt, aspectRatio) {
  const ai = getClient();
  const config = { responseModalities: ["IMAGE"] };
  if (aspectRatio && VALID_RATIOS.includes(aspectRatio)) {
    config.imageConfig = { aspectRatio };
  }

  const response = await ai.models.generateContent({ model, contents: prompt, config });

  const parts = response?.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    const inline = part.inlineData || part.inline_data;
    if (inline && inline.data) {
      return {
        mimeType: inline.mimeType || inline.mime_type || "image/png",
        base64: inline.data,
        model,
      };
    }
  }
  throw new Error(`Model ${model} returned no image data`);
}

/**
 * Call a model with exponential backoff on transient errors.
 * (Matches upstream PaperBanana's tenacity wrapper: 3 attempts, 1s..10s backoff.)
 */
async function callModelWithRetry(model, prompt, aspectRatio, maxAttempts = 3) {
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await callModel(model, prompt, aspectRatio);
    } catch (err) {
      lastErr = err;
      const kind = classifyError(err?.message);
      if (kind !== "transient" || attempt === maxAttempts) throw err;
      const delay = Math.min(10_000, 1000 * Math.pow(2, attempt - 1)) + Math.random() * 400;
      console.warn(`[gemini] transient on ${model} (attempt ${attempt}/${maxAttempts}): ${cleanErrorMessage(err)} — retrying in ${Math.round(delay)}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

/**
 * Generate an image from a user-supplied description.
 * Tries the configured model first, then falls back to other image-capable models
 * on NOT_FOUND / UNSUPPORTED errors so the site keeps working if one variant is
 * rotated out.
 *
 * @param {object} opts
 * @param {string} opts.description
 * @param {string} [opts.aspectRatio] — one of VALID_RATIOS
 * @param {string} [opts.style] — one of listStyles()
 * @param {string} [opts.textDensity] — one of listTextDensities()
 * @returns {Promise<{mimeType:string, base64:string, model:string, promptUsed:string}>}
 */
async function generateImage({ description, aspectRatio, style, textDensity, colorTheme, model }) {
  if (!description || !description.trim()) {
    throw new Error("description is required");
  }
  const prompt = buildImagePrompt(description, { style, textDensity, colorTheme });

  // Build the ordered list of models to try.
  //   - "auto" (or omitted): use the full fallback chain, and cross-fall-back
  //     on UNAVAILABLE / INTERNAL after retries exhaust on a given model.
  //   - explicit model id: try only that one, with retries but no fallback.
  let tryOrder;
  let crossFallbackOnOverload;
  const explicit = model && model !== "auto" ? model : null;
  if (explicit) {
    tryOrder = [explicit];
    crossFallbackOnOverload = false;
  } else {
    tryOrder = [DEFAULT_MODEL, ...FALLBACK_MODELS.filter((m) => m !== DEFAULT_MODEL)];
    crossFallbackOnOverload = true;
  }

  const errors = [];
  for (let i = 0; i < tryOrder.length; i++) {
    const m = tryOrder[i];
    const isLast = i === tryOrder.length - 1;
    try {
      const out = await callModelWithRetry(m, prompt, aspectRatio);
      return { ...out, promptUsed: prompt };
    } catch (err) {
      const msg = cleanErrorMessage(err);
      errors.push(`${m}: ${msg}`);
      const kind = classifyError(err?.message);

      // Always fall back to the next model if this one can't serve the request.
      if (kind === "fallback") continue;

      // In auto mode, also cross-fall-back after a model is hopelessly overloaded.
      if (crossFallbackOnOverload && kind === "transient" && !isLast) continue;

      // Otherwise surface the error.
      const wrapped = new Error(`Gemini ${m}: ${msg}`);
      wrapped.attempts = errors;
      throw wrapped;
    }
  }
  const e = new Error("All Gemini image models failed:\n" + errors.join("\n"));
  e.attempts = errors;
  throw e;
}

module.exports = {
  generateImage,
  listImageModels,
  VALID_RATIOS,
  DEFAULT_IMAGE_MODEL,
};
