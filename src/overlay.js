const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

// Default Vizuara logo lives in public/; API callers can also provide a custom
// logo as base64.
const LOGO_ASSET_PATH = path.join(__dirname, "..", "public", "vizuara-logo.png");

// ---- XML/SVG escaping ----
function xmlEscape(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Named anchor positions map to (x, y) in pixels given image dims + padding.
// Useful so API callers don't have to think in pixels for common placements.
function resolveNamedPosition(name, { imageW, imageH, w = 0, h = 0, pad = 24 }) {
  switch ((name || "").toLowerCase()) {
    case "top-left":      return { x: pad, y: pad };
    case "top-center":    return { x: Math.round((imageW - w) / 2), y: pad };
    case "top-right":     return { x: imageW - w - pad, y: pad };
    case "center":        return { x: Math.round((imageW - w) / 2), y: Math.round((imageH - h) / 2) };
    case "bottom-left":   return { x: pad, y: imageH - h - pad };
    case "bottom-center": return { x: Math.round((imageW - w) / 2), y: imageH - h - pad };
    case "bottom-right":  return { x: imageW - w - pad, y: imageH - h - pad };
    default:              return null;
  }
}

function textToSvg(opts) {
  const {
    text, fontFamily = "sans-serif", fontSize = 48,
    color = "#1f2330", bold = false, italic = false, underline = false,
    stroke = null, strokeWidth = 0,
  } = opts;
  const fontStyle = italic ? "italic" : "normal";
  const fontWeight = bold ? 700 : 400;
  const decoration = underline ? "underline" : "none";
  const strokeAttrs = stroke ? `stroke="${xmlEscape(stroke)}" stroke-width="${strokeWidth}" paint-order="stroke"` : "";
  // A generous bounding box: width = chars * fontSize * 0.7 (rough), height = fontSize * 1.3
  const width = Math.max(1, Math.round(text.length * fontSize * 0.62) + 40);
  const height = Math.round(fontSize * 1.4) + 10;
  // dominant-baseline places the baseline roughly where we want.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <text
    x="10"
    y="${fontSize + 5}"
    font-family="${xmlEscape(fontFamily)}, sans-serif"
    font-size="${fontSize}"
    font-weight="${fontWeight}"
    font-style="${fontStyle}"
    text-decoration="${decoration}"
    fill="${xmlEscape(color)}"
    ${strokeAttrs}
  >${xmlEscape(text)}</text>
</svg>`;
  return { svg, width, height };
}

// Normalise a heading / url input (string OR rich object) into a rich object.
function normaliseText(input, defaults = {}) {
  if (!input) return null;
  if (typeof input === "string") {
    const t = input.trim();
    return t ? { ...defaults, text: t } : null;
  }
  if (typeof input === "object" && input.text && String(input.text).trim()) {
    return {
      text: String(input.text),
      fontFamily: input.font_family || input.fontFamily || defaults.fontFamily,
      fontSize: input.font_size || input.fontSize || defaults.fontSize,
      color: input.color || defaults.color,
      bold: !!(input.bold ?? defaults.bold),
      italic: !!(input.italic ?? defaults.italic),
      underline: !!(input.underline ?? defaults.underline),
      position: input.position || defaults.position,
      x: input.x != null ? Number(input.x) : undefined,
      y: input.y != null ? Number(input.y) : undefined,
    };
  }
  return null;
}

/**
 * Compose heading + logo + URL overlays onto a base PNG.
 *
 * @param {object} opts
 * @param {Buffer} opts.imageBuffer — the base image bytes
 * @param {string|object} [opts.heading] — string (simple) or rich object
 * @param {string|object} [opts.url] — string or rich object
 * @param {boolean} [opts.showLogo]
 * @param {object} [opts.logo] — rich logo config
 *   { base64, size, x, y, position }
 * @returns {Promise<{buffer:Buffer, width:number, height:number, hasLogoAsset:boolean}>}
 */
async function applyOverlay(opts) {
  const { imageBuffer } = opts;
  const base = sharp(imageBuffer);
  const meta = await base.metadata();
  const W = meta.width, H = meta.height;

  const composites = [];
  let hasLogoAsset = false;

  // ---- Heading ----
  const heading = normaliseText(opts.heading, {
    fontFamily: "sans-serif",
    fontSize: Math.max(32, Math.round(W * 0.035)),
    color: "#1f2330",
    bold: true,
    italic: false,
    underline: false,
    position: "top-left",
  });
  if (heading) {
    const { svg, width, height } = textToSvg(heading);
    const buf = Buffer.from(svg);
    const png = await sharp(buf).png().toBuffer();
    const pngMeta = await sharp(png).metadata();
    let x = heading.x, y = heading.y;
    if (x == null || y == null) {
      const pos = resolveNamedPosition(heading.position || "top-left", {
        imageW: W, imageH: H, w: pngMeta.width, h: pngMeta.height,
      });
      if (pos) { x = pos.x; y = pos.y; }
    }
    composites.push({ input: png, left: Math.round(x || 0), top: Math.round(y || 0) });
  }

  // ---- Logo ----
  const logoCfg = opts.logo || {};
  if (opts.showLogo || logoCfg.base64 || logoCfg.url) {
    const targetHeight = parseInt(logoCfg.size, 10) || Math.max(48, Math.round(H * 0.06));
    let logoBuf = null;

    if (logoCfg.base64) {
      logoBuf = Buffer.from(String(logoCfg.base64), "base64");
    } else if (fs.existsSync(LOGO_ASSET_PATH)) {
      logoBuf = fs.readFileSync(LOGO_ASSET_PATH);
      hasLogoAsset = true;
    }

    if (logoBuf) {
      const resized = await sharp(logoBuf).resize({ height: targetHeight }).png().toBuffer();
      const lm = await sharp(resized).metadata();
      let x = logoCfg.x, y = logoCfg.y;
      if (x == null || y == null) {
        const pos = resolveNamedPosition(logoCfg.position || "bottom-left", {
          imageW: W, imageH: H, w: lm.width, h: lm.height,
        });
        if (pos) { x = pos.x; y = pos.y; }
      }
      composites.push({ input: resized, left: Math.round(x || 0), top: Math.round(y || 0) });
    }
  }

  // ---- URL ----
  const urlTxt = normaliseText(opts.url, {
    fontFamily: "sans-serif",
    fontSize: Math.max(16, Math.round(W * 0.018)),
    color: "#1f2330",
    bold: false,
    italic: false,
    underline: false,
    position: "bottom-right",
  });
  if (urlTxt) {
    const { svg } = textToSvg(urlTxt);
    const buf = Buffer.from(svg);
    const png = await sharp(buf).png().toBuffer();
    const pngMeta = await sharp(png).metadata();
    let x = urlTxt.x, y = urlTxt.y;
    if (x == null || y == null) {
      const pos = resolveNamedPosition(urlTxt.position || "bottom-right", {
        imageW: W, imageH: H, w: pngMeta.width, h: pngMeta.height,
      });
      if (pos) { x = pos.x; y = pos.y; }
    }
    composites.push({ input: png, left: Math.round(x || 0), top: Math.round(y || 0) });
  }

  if (composites.length === 0) {
    const buf = await base.png().toBuffer();
    return { buffer: buf, width: W, height: H, hasLogoAsset };
  }
  const out = await base.composite(composites).png().toBuffer();
  return { buffer: out, width: W, height: H, hasLogoAsset };
}

module.exports = { applyOverlay };
