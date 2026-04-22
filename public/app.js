const $ = (id) => document.getElementById(id);

const descEl = $("description");
const styleEl = $("style");
const densityEl = $("textDensity");
const ratioEl = $("aspectRatio");
const itersEl = $("iterations");
const modelEl = $("imageModel");
const colorThemesEl = $("colorThemes");
const genBtn = $("generate");
const resetBtn = $("reset");
const clearSessionBtn = $("clearSession");
const exportBackupBtn = $("exportBackup");
const importBackupInput = $("importBackupInput");
const statusEl = $("status");
const emptyEl = $("empty");
const gridEl = $("grid");
const progressEl = $("progress");
const progressLabel = $("progressLabel");
const progressFill = $("progressFill");
const progressSteps = $("progressSteps");
const editorEl = $("editor");
const editorCanvasEl = $("editorCanvas");
const downloadEl = $("download");
const editorResetBtn = $("editorReset");
const metaEl = $("meta");
const userEl = $("user");

// Editor controls
const headingOn = $("headingOn");
const headingText = $("headingText");
const headingFont = $("headingFont");
const headingSize = $("headingSize");
const headingSizeVal = $("headingSizeVal");
const headingColor = $("headingColor");
const headingBoldBtn = $("headingBoldBtn");
const headingItalicBtn = $("headingItalicBtn");
const headingUnderlineBtn = $("headingUnderlineBtn");

const logoOn = $("logoOn");
const logoFileInput = $("logoFile");
const logoResetDefault = $("logoResetDefault");
const logoSize = $("logoSize");
const logoSizeVal = $("logoSizeVal");

const urlOn = $("urlOn");
const urlText = $("urlText");
const urlFont = $("urlFont");
const urlSize = $("urlSize");
const urlSizeVal = $("urlSizeVal");
const urlColor = $("urlColor");
const urlBoldBtn = $("urlBoldBtn");
const urlItalicBtn = $("urlItalicBtn");
const urlUnderlineBtn = $("urlUnderlineBtn");

// Toggle state for type styling (bold/italic/underline per text object)
const textStyle = {
  heading: { bold: true, italic: false, underline: false },
  url: { bold: false, italic: false, underline: false },
};

let currentIterations = [];
let selectedIdx = -1;
let defaults = { style: "default", textDensity: "standard", colorTheme: "default", imageModel: "auto" };
let selectedColorTheme = "default";
let availableColorThemes = [];
let restoring = false;

const STORAGE_KEY = "pb:session:v1";

const FONT_FAMILIES = [
  { value: "Inter", label: "Inter (clean modern)" },
  { value: "Roboto", label: "Roboto" },
  { value: "Montserrat", label: "Montserrat" },
  { value: "Lato", label: "Lato" },
  { value: "Source Sans 3", label: "Source Sans 3" },
  { value: "Space Grotesk", label: "Space Grotesk" },
  { value: "Playfair Display", label: "Playfair Display (serif)" },
  { value: "Source Serif 4", label: "Source Serif (serif)" },
  { value: "IBM Plex Mono", label: "IBM Plex Mono (mono)" },
  { value: "Georgia", label: "Georgia (system serif)" },
  { value: "Arial", label: "Arial (system sans)" },
];

// Fabric editor state
let fabricCanvas = null;
let baseImageObj = null;
let headingObj = null;
let logoObj = null;
let urlObj = null;
let customLogoDataUrl = null;
let baseImgScale = 1;

// -------- session / config --------
async function loadMe() {
  try {
    const r = await fetch("/api/me");
    if (!r.ok) throw new Error();
    const me = await r.json();
    userEl.innerHTML = "";
    if (me.photo) {
      const img = document.createElement("img");
      img.src = me.photo;
      img.alt = me.displayName || me.email;
      userEl.appendChild(img);
    }
    const span = document.createElement("span");
    span.textContent = me.email;
    userEl.appendChild(span);
    const out = document.createElement("a");
    out.href = "#";
    out.textContent = "Sign out";
    out.className = "muted";
    out.style.marginLeft = "8px";
    out.onclick = async (ev) => {
      ev.preventDefault();
      await fetch("/auth/logout", { method: "POST" });
      location.href = "/login";
    };
    userEl.appendChild(out);
  } catch {
    location.href = "/login";
  }
}

async function loadConfig() {
  try {
    const r = await fetch("/api/config");
    if (!r.ok) return;
    const cfg = await r.json();
    if (cfg.defaults) defaults = { ...defaults, ...cfg.defaults };
    fillSelect(styleEl, cfg.styles || [], defaults.style);
    fillSelect(densityEl, cfg.textDensities || [], defaults.textDensity);
    fillSelect(modelEl, cfg.imageModels || [], defaults.imageModel);
    availableColorThemes = cfg.colorThemes || [];
    renderColorThemes();
  } catch {}
}

function renderColorThemes() {
  colorThemesEl.innerHTML = "";
  for (const t of availableColorThemes) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "color-chip" + (t.value === "default" ? " default" : "");
    chip.dataset.value = t.value;
    chip.title = t.label;

    const sw = document.createElement("div");
    sw.className = "swatch";
    if (t.swatch && t.swatch.length) {
      for (const color of t.swatch) {
        const s = document.createElement("span");
        s.style.background = color;
        sw.appendChild(s);
      }
    } else {
      sw.style.background = "linear-gradient(135deg, #faf8f3, #fff1b8)";
    }
    chip.appendChild(sw);

    const lbl = document.createElement("div");
    lbl.className = "label";
    lbl.textContent = t.label;
    chip.appendChild(lbl);

    chip.addEventListener("click", () => {
      // Click same chip = clear (back to default). Click different = select.
      if (selectedColorTheme === t.value && t.value !== "default") {
        selectedColorTheme = "default";
      } else {
        selectedColorTheme = t.value;
      }
      updateColorThemeSelection();
      persistSession();
    });
    colorThemesEl.appendChild(chip);
  }
  updateColorThemeSelection();
}

function updateColorThemeSelection() {
  Array.from(colorThemesEl.children).forEach((c) => {
    c.classList.toggle("selected", c.dataset.value === selectedColorTheme);
  });
}

function fillSelect(sel, items, defaultValue) {
  sel.innerHTML = "";
  for (const { value, label } of items) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    if (value === defaultValue) o.selected = true;
    sel.appendChild(o);
  }
}

// -------- utility --------
function setStatus(msg, isError = false) {
  if (!msg) {
    statusEl.hidden = true;
    statusEl.textContent = "";
    statusEl.classList.remove("error");
    return;
  }
  statusEl.hidden = false;
  statusEl.textContent = msg;
  statusEl.classList.toggle("error", !!isError);
}

function base64ToBlob(base64, mimeType) {
  const byteChars = atob(base64);
  const bytes = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
  return new Blob([bytes], { type: mimeType || "image/png" });
}

// -------- progressive grid --------
function initGrid(nIterations) {
  gridEl.innerHTML = "";
  currentIterations = new Array(nIterations).fill(null);
  for (let i = 0; i < nIterations; i++) {
    const card = document.createElement("div");
    card.className = "card pending";
    card.dataset.idx = i;
    card.id = `card-${i}`;
    card.innerHTML = `<div><div class="iter-spinner" style="visibility:hidden"></div><div>Iteration ${i + 1} — waiting…</div></div>`;
    gridEl.appendChild(card);
  }
}

function setCardGenerating(idx) {
  const card = document.getElementById(`card-${idx}`);
  if (!card) return;
  card.className = "card pending";
  card.innerHTML = `<div><div class="iter-spinner"></div><div>Iteration ${idx + 1} — generating image…</div></div>`;
}

function setCardImage(idx, iter, isFinal) {
  const card = document.getElementById(`card-${idx}`);
  if (!card) return;
  currentIterations[idx] = iter;

  card.className = "card";
  card.innerHTML = "";
  card.onclick = () => selectIteration(idx);

  const img = document.createElement("img");
  img.src = URL.createObjectURL(base64ToBlob(iter.base64, iter.mimeType));
  card.appendChild(img);

  const tag = document.createElement("div");
  tag.className = "tag";
  const iterLabel = document.createElement("span");
  iterLabel.textContent = `Iteration ${iter.iteration}${isFinal ? " (final)" : ""} · ${Math.round((iter.durationMs || iter.generationMs || 0) / 100) / 10}s`;
  tag.appendChild(iterLabel);
  const pick = document.createElement("span");
  pick.className = "pick";
  pick.textContent = "click to select";
  tag.appendChild(pick);
  card.appendChild(tag);

  // Placeholder for critique while it's being generated (only on non-final iters).
  if (!isFinal) {
    const c = document.createElement("div");
    c.className = "critique-loading";
    c.id = `critique-${idx}`;
    c.textContent = "Critiquing image… (feedback will shape the next iteration)";
    card.appendChild(c);
  }
}

function setCardCritique(idx, critique) {
  const card = document.getElementById(`card-${idx}`);
  if (!card) return;
  currentIterations[idx] = { ...currentIterations[idx], critique };
  const old = document.getElementById(`critique-${idx}`);
  if (old) old.remove();
  const c = document.createElement("div");
  c.className = "critique";
  c.textContent = critique.notes || "(empty critique)";
  card.appendChild(c);
}

function setCardCriticError(idx, message) {
  const card = document.getElementById(`card-${idx}`);
  if (!card) return;
  const old = document.getElementById(`critique-${idx}`);
  if (old) old.remove();
  const c = document.createElement("div");
  c.className = "critique-loading";
  c.textContent = `Critic skipped: ${message}`;
  card.appendChild(c);
}

function selectIteration(idx, keepEditorHidden = false) {
  const it = currentIterations[idx];
  if (!it || !it.base64) return;
  selectedIdx = idx;
  Array.from(gridEl.children).forEach((c, i) => {
    c.classList.toggle("selected", i === idx);
    const pick = c.querySelector(".pick");
    if (pick) pick.textContent = i === idx ? "selected ✓" : "click to select";
  });
  if (!keepEditorHidden) {
    editorEl.hidden = false;
    loadImageIntoEditor(it);
  }
}

function updateMeta() {
  if (selectedIdx < 0) return;
  const it = currentIterations[selectedIdx];
  const bits = [`iteration ${it.iteration}`, it.model || ""];
  if (fabricCanvas && baseImageObj && baseImageObj._element) {
    const nativeW = baseImageObj._element.naturalWidth;
    const nativeH = baseImageObj._element.naturalHeight;
    bits.push(`download: ${nativeW}×${nativeH}`);
  }
  metaEl.textContent = bits.filter(Boolean).join(" · ");
}

// -------- progress bar --------
function buildProgressSteps(n) {
  progressSteps.innerHTML = "";
  for (let i = 1; i <= n; i++) {
    const s = document.createElement("div");
    s.className = "progress-step";
    s.id = `step-gen-${i}`;
    s.innerHTML = `<span class="dot"></span>Gen ${i}`;
    progressSteps.appendChild(s);
    if (i < n) {
      const c = document.createElement("div");
      c.className = "progress-step";
      c.id = `step-crit-${i}`;
      c.innerHTML = `<span class="dot"></span>Refine`;
      progressSteps.appendChild(c);
    }
  }
}
function markStep(id, state) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove("active", "done");
  if (state) el.classList.add(state);
}
function updateProgressFill(completed, total) {
  const pct = Math.min(100, Math.round((completed / total) * 100));
  progressFill.style.width = pct + "%";
}

// -------- generate (streaming) --------
async function generate() {
  const description = descEl.value.trim();
  if (!description) {
    setStatus("Please enter a description first.", true);
    descEl.focus();
    return;
  }
  const n = parseInt(itersEl.value, 10) || 3;
  const totalSteps = n + (n - 1); // gen + critique between gens

  genBtn.disabled = true;
  setStatus("");
  emptyEl.hidden = true;
  gridEl.hidden = false;
  editorEl.hidden = true;
  disposeEditor();
  selectedIdx = -1;

  progressEl.hidden = false;
  progressLabel.textContent = `Starting pipeline (${n} iteration${n === 1 ? "" : "s"})…`;
  progressFill.style.width = "0%";
  buildProgressSteps(n);
  initGrid(n);

  let completedSteps = 0;
  const startedAt = Date.now();
  const tickInterval = setInterval(() => {
    const s = Math.round((Date.now() - startedAt) / 1000);
    const suffix = progressLabel.dataset.base || progressLabel.textContent;
    if (!progressLabel.dataset.base) progressLabel.dataset.base = suffix;
    progressLabel.textContent = `${progressLabel.dataset.base} (${s}s)`;
  }, 500);

  const setPhase = (text) => {
    progressLabel.dataset.base = text;
  };

  try {
    const r = await fetch("/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        description,
        aspectRatio: ratioEl.value || undefined,
        style: styleEl.value || undefined,
        textDensity: densityEl.value || undefined,
        colorTheme: selectedColorTheme || undefined,
        model: modelEl.value || undefined,
        iterations: n,
      }),
    });
    if (r.status === 401) { location.href = "/login"; return; }
    if (!r.ok) {
      const err = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
      throw new Error(err.error || "generation failed");
    }

    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let donePayload = null;
    let errorPayload = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let ev;
        try { ev = JSON.parse(line); } catch { continue; }
        handleEvent(ev);
        if (ev.type === "done") donePayload = ev;
        if (ev.type === "error") errorPayload = ev;
      }
    }

    if (errorPayload) throw new Error(errorPayload.error || "generation failed");
    if (donePayload) {
      progressFill.style.width = "100%";
      setPhase(`Done in ${Math.round(donePayload.totalMs / 100) / 10}s — click any iteration to select.`);
      // auto-select final iteration if one arrived
      const lastIdx = currentIterations.findLastIndex((x) => x && x.base64);
      if (lastIdx >= 0) selectIteration(lastIdx);
    }

    function handleEvent(ev) {
      if (ev.type === "meta") return;
      if (ev.type === "gen:start") {
        markStep(`step-gen-${ev.iteration}`, "active");
        setPhase(`Iteration ${ev.iteration} of ${n} — generating image…`);
        setCardGenerating(ev.iteration - 1);
      } else if (ev.type === "gen:done") {
        markStep(`step-gen-${ev.iteration}`, "done");
        completedSteps++;
        updateProgressFill(completedSteps, totalSteps);
        const isFinal = ev.iteration === n;
        setCardImage(ev.iteration - 1, {
          iteration: ev.iteration,
          base64: ev.image.base64,
          mimeType: ev.image.mimeType,
          model: ev.image.model,
          generationMs: ev.generationMs,
          durationMs: ev.generationMs,
        }, isFinal);
        // Auto-preview every image as it arrives so the user sees the latest right away.
        selectIteration(ev.iteration - 1, /*keepEditorHidden=*/ !isFinal);
        if (isFinal) {
          setPhase(`Iteration ${ev.iteration} of ${n} — done`);
        }
        persistSession();
      } else if (ev.type === "critic:start") {
        markStep(`step-crit-${ev.iteration}`, "active");
        setPhase(`Critiquing iteration ${ev.iteration} to guide the next image…`);
      } else if (ev.type === "critic:done") {
        markStep(`step-crit-${ev.iteration}`, "done");
        completedSteps++;
        updateProgressFill(completedSteps, totalSteps);
        setCardCritique(ev.iteration - 1, ev.critique);
        persistSession();
      } else if (ev.type === "critic:error") {
        markStep(`step-crit-${ev.iteration}`, "done");
        completedSteps++;
        updateProgressFill(completedSteps, totalSteps);
        setCardCriticError(ev.iteration - 1, ev.error);
      } else if (ev.type === "error") {
        throw new Error(ev.error || "pipeline error");
      }
    }
  } catch (err) {
    setStatus("Failed: " + err.message, true);
    progressEl.hidden = true;
  } finally {
    clearInterval(tickInterval);
    genBtn.disabled = false;
  }
}

function resetDefaults() {
  styleEl.value = defaults.style;
  densityEl.value = defaults.textDensity;
  ratioEl.value = "";
  itersEl.value = "3";
  modelEl.value = defaults.imageModel || "auto";
  selectedColorTheme = defaults.colorTheme || "default";
  updateColorThemeSelection();
  setStatus("");
  persistSession();
}

// -------- persistence --------
let persistTimer = null;
function persistSession() {
  if (restoring) return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(doPersist, 400);
}

function doPersist() {
  try {
    const json = JSON.stringify(buildCurrentStateObject());
    if (json.length > 4_500_000) {
      console.warn("[persist] session too large to store:", json.length);
      return;
    }
    localStorage.setItem(STORAGE_KEY, json);
  } catch (e) {
    console.warn("[persist] save failed:", e && e.message);
  }
}

function captureEditorState() {
  if (!fabricCanvas || selectedIdx < 0) return null;
  const toSnap = (obj, extras = {}) => {
    if (!obj) return null;
    return {
      visible: !!obj.visible,
      left: obj.left,
      top: obj.top,
      scaleX: obj.scaleX,
      scaleY: obj.scaleY,
      angle: obj.angle,
      ...extras,
    };
  };
  return {
    heading: toSnap(headingObj, {
      text: headingObj ? headingObj.text : headingText.value,
      fontFamily: headingFont.value,
      fontSize: parseInt(headingSize.value, 10),
      fill: headingColor.value,
      bold: textStyle.heading.bold,
      italic: textStyle.heading.italic,
      underline: textStyle.heading.underline,
    }),
    url: toSnap(urlObj, {
      text: urlObj ? urlObj.text : urlText.value,
      fontFamily: urlFont.value,
      fontSize: parseInt(urlSize.value, 10),
      fill: urlColor.value,
      bold: textStyle.url.bold,
      italic: textStyle.url.italic,
      underline: textStyle.url.underline,
    }),
    logo: logoObj
      ? {
          ...toSnap(logoObj),
          sizeSlider: parseInt(logoSize.value, 10),
          customDataUrl: customLogoDataUrl,
        }
      : {
          visible: false,
          sizeSlider: parseInt(logoSize.value, 10),
          customDataUrl: customLogoDataUrl,
        },
    toggles: {
      heading: headingOn.checked,
      logo: logoOn.checked,
      url: urlOn.checked,
    },
  };
}

async function restoreSession(fromState) {
  let state = fromState;
  if (!state) {
    let raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch {}
    if (!raw) return false;
    try { state = JSON.parse(raw); } catch { return false; }
  }
  if (!state || state.v !== 1) return false;

  restoring = true;
  try {
    // restore input panel
    if (state.input) {
      descEl.value = state.input.description || "";
      if (state.input.style) styleEl.value = state.input.style;
      if (state.input.textDensity) densityEl.value = state.input.textDensity;
      if (state.input.aspectRatio != null) ratioEl.value = state.input.aspectRatio;
      if (state.input.iterations) itersEl.value = state.input.iterations;
      if (state.input.imageModel) modelEl.value = state.input.imageModel;
      selectedColorTheme = state.input.colorTheme || "default";
      updateColorThemeSelection();
    }

    // restore iterations
    if (Array.isArray(state.iterations) && state.iterations.length) {
      emptyEl.hidden = true;
      gridEl.hidden = false;
      const n = state.iterations.length;
      initGrid(n);
      state.iterations.forEach((it, idx) => {
        const isFinal = idx === n - 1;
        setCardImage(idx, {
          iteration: it.iteration,
          base64: it.base64,
          mimeType: it.mimeType,
          model: it.model,
          generationMs: it.generationMs,
          durationMs: it.generationMs,
        }, isFinal);
        if (it.critique) setCardCritique(idx, it.critique);
      });

      const idx = (typeof state.selectedIdx === "number" && state.selectedIdx >= 0 && state.selectedIdx < n)
        ? state.selectedIdx
        : n - 1;

      // open editor and then restore editor state
      editorEl.hidden = false;
      selectedIdx = idx;
      Array.from(gridEl.children).forEach((c, i) => {
        c.classList.toggle("selected", i === idx);
        const pick = c.querySelector(".pick");
        if (pick) pick.textContent = i === idx ? "selected ✓" : "click to select";
      });
      await loadImageIntoEditor(currentIterations[idx]);
      await applyEditorState(state.editor);
      setStatus("Restored from saved session. Your in-progress edits are preserved.");
    }
  } finally {
    restoring = false;
  }
  return true;
}

async function applyEditorState(edState) {
  if (!edState || !fabricCanvas) return;

  if (edState.toggles) {
    headingOn.checked = !!edState.toggles.heading;
    logoOn.checked = !!edState.toggles.logo;
    urlOn.checked = !!edState.toggles.url;
  }

  // heading
  if (edState.heading && headingObj) {
    if (edState.heading.text != null) {
      headingObj.text = edState.heading.text;
      headingText.value = edState.heading.text;
    }
    if (edState.heading.fontFamily) {
      await document.fonts.load(`800 48px "${edState.heading.fontFamily}"`);
      headingObj.set("fontFamily", edState.heading.fontFamily);
      headingFont.value = edState.heading.fontFamily;
    }
    if (edState.heading.fontSize) {
      headingObj.set("fontSize", edState.heading.fontSize);
      headingSize.value = edState.heading.fontSize;
      headingSizeVal.textContent = edState.heading.fontSize;
    }
    if (edState.heading.fill) {
      headingObj.set("fill", edState.heading.fill);
      headingColor.value = edState.heading.fill;
    }
    if (typeof edState.heading.bold === "boolean") textStyle.heading.bold = edState.heading.bold;
    if (typeof edState.heading.italic === "boolean") textStyle.heading.italic = edState.heading.italic;
    if (typeof edState.heading.underline === "boolean") textStyle.heading.underline = edState.heading.underline;
    applyTextStyle("heading");
    if (edState.heading.left != null) headingObj.left = edState.heading.left;
    if (edState.heading.top != null) headingObj.top = edState.heading.top;
    if (edState.heading.scaleX) headingObj.scaleX = edState.heading.scaleX;
    if (edState.heading.scaleY) headingObj.scaleY = edState.heading.scaleY;
    if (edState.heading.angle) headingObj.angle = edState.heading.angle;
    headingObj.setCoords();
  }

  // url
  if (edState.url && urlObj) {
    if (edState.url.text != null) {
      urlObj.text = edState.url.text;
      urlText.value = edState.url.text;
    }
    if (edState.url.fontFamily) {
      await document.fonts.load(`400 24px "${edState.url.fontFamily}"`);
      urlObj.set("fontFamily", edState.url.fontFamily);
      urlFont.value = edState.url.fontFamily;
    }
    if (edState.url.fontSize) {
      urlObj.set("fontSize", edState.url.fontSize);
      urlSize.value = edState.url.fontSize;
      urlSizeVal.textContent = edState.url.fontSize;
    }
    if (edState.url.fill) {
      urlObj.set("fill", edState.url.fill);
      urlColor.value = edState.url.fill;
    }
    if (typeof edState.url.bold === "boolean") textStyle.url.bold = edState.url.bold;
    if (typeof edState.url.italic === "boolean") textStyle.url.italic = edState.url.italic;
    if (typeof edState.url.underline === "boolean") textStyle.url.underline = edState.url.underline;
    applyTextStyle("url");
    if (edState.url.left != null) urlObj.left = edState.url.left;
    if (edState.url.top != null) urlObj.top = edState.url.top;
    if (edState.url.scaleX) urlObj.scaleX = edState.url.scaleX;
    if (edState.url.scaleY) urlObj.scaleY = edState.url.scaleY;
    if (edState.url.angle) urlObj.angle = edState.url.angle;
    urlObj.setCoords();
  }

  // logo
  if (edState.logo) {
    if (edState.logo.sizeSlider) {
      logoSize.value = edState.logo.sizeSlider;
      logoSizeVal.textContent = edState.logo.sizeSlider;
    }
    if (edState.logo.customDataUrl) {
      customLogoDataUrl = edState.logo.customDataUrl;
      await replaceLogo(customLogoDataUrl);
    }
    if (logoObj) {
      if (edState.logo.left != null) logoObj.left = edState.logo.left;
      if (edState.logo.top != null) logoObj.top = edState.logo.top;
      if (edState.logo.scaleX) { logoObj.scaleX = edState.logo.scaleX; logoObj.scaleY = edState.logo.scaleY; }
      if (edState.logo.angle) logoObj.angle = edState.logo.angle;
      logoObj.setCoords();
    }
  }

  updateToggleButtons();
  syncVisibility();
  fabricCanvas.requestRenderAll();
}

function buildCurrentStateObject() {
  return {
    v: 1,
    input: {
      description: descEl.value,
      style: styleEl.value,
      textDensity: densityEl.value,
      aspectRatio: ratioEl.value,
      iterations: itersEl.value,
      colorTheme: selectedColorTheme,
      imageModel: modelEl.value,
    },
    iterations: currentIterations
      .filter((x) => x && x.base64)
      .map((it) => ({
        iteration: it.iteration,
        base64: it.base64,
        mimeType: it.mimeType,
        model: it.model,
        generationMs: it.generationMs || it.durationMs,
        critique: it.critique ? { notes: it.critique.notes, accept: !!it.critique.accept } : null,
      })),
    selectedIdx,
    editor: captureEditorState(),
    savedAt: Date.now(),
  };
}

function downloadBackup() {
  const state = buildCurrentStateObject();
  if (!state.iterations.length) {
    setStatus("Nothing to back up yet — generate an image first.", true);
    return;
  }
  const blob = new Blob([JSON.stringify(state)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
  a.download = `paperbanana-session-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setStatus("Backup downloaded. Keep it somewhere safe — you can restore it later via Restore backup.");
}

async function handleBackupImport(file) {
  if (!file) return;
  setStatus("Loading backup…");
  try {
    const text = await file.text();
    const state = JSON.parse(text);
    if (!state || state.v !== 1 || !Array.isArray(state.iterations)) {
      throw new Error("Not a valid PaperBanana backup file.");
    }
    // Wipe in-memory session state, then restore from file.
    currentIterations = [];
    selectedIdx = -1;
    disposeEditor();
    gridEl.innerHTML = "";
    editorEl.hidden = true;
    const ok = await restoreSession(state);
    if (!ok) throw new Error("Backup could not be restored.");
    // Also write it to localStorage so subsequent refreshes work without re-importing.
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
    setStatus(`Restored ${state.iterations.length} iteration${state.iterations.length === 1 ? "" : "s"} from backup.`);
  } catch (err) {
    setStatus("Could not restore backup: " + err.message, true);
  }
}

function clearSavedSession() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
  // Also reset UI to blank state
  descEl.value = "";
  currentIterations = [];
  selectedIdx = -1;
  disposeEditor();
  editorEl.hidden = true;
  gridEl.hidden = true;
  gridEl.innerHTML = "";
  emptyEl.hidden = false;
  progressEl.hidden = true;
  setStatus("Saved session cleared.");
}

// -------- Fabric canvas editor --------
function fillFontSelect(sel, defaultValue) {
  sel.innerHTML = "";
  for (const { value, label } of FONT_FAMILIES) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    o.style.fontFamily = value;
    if (value === defaultValue) o.selected = true;
    sel.appendChild(o);
  }
}

function initEditorControlsOnce() {
  if (headingFont.options.length === 0) fillFontSelect(headingFont, "Inter");
  if (urlFont.options.length === 0) fillFontSelect(urlFont, "Inter");
}

function disposeEditor() {
  if (fabricCanvas) {
    fabricCanvas.dispose();
    fabricCanvas = null;
  }
  baseImageObj = headingObj = logoObj = urlObj = null;
}

async function loadImageIntoEditor(iter) {
  initEditorControlsOnce();
  disposeEditor();

  // Build an HTMLImageElement from the iteration's base64.
  const dataUrl = `data:${iter.mimeType || "image/png"};base64,${iter.base64}`;
  const img = await loadImage(dataUrl);
  const W = img.naturalWidth, H = img.naturalHeight;

  // Match internal canvas dims to display dims so Fabric's hit-testing is
  // trivially correct (no CSS-vs-internal coord mismatch). We scale the base
  // image into the canvas and upscale on export.
  const wrap = editorCanvasEl.parentElement;
  const maxDisplayWidth = Math.max(240, wrap.clientWidth - 20);
  const scale = Math.min(1, maxDisplayWidth / W);
  const cw = Math.round(W * scale);
  const ch = Math.round(H * scale);
  baseImgScale = scale;

  fabricCanvas = new fabric.Canvas(editorCanvasEl, {
    width: cw,
    height: ch,
    backgroundColor: "#ffffff",
    preserveObjectStacking: true,
    selection: true,
  });
  fabricCanvas.on("object:modified", () => persistSession());

  // Base image scaled via object-level scale so it fits the canvas.
  baseImageObj = new fabric.Image(img, {
    left: 0, top: 0,
    scaleX: scale, scaleY: scale,
    selectable: false, evented: false,
    hoverCursor: "default",
  });
  fabricCanvas.add(baseImageObj);

  // Make sure our fonts are ready before adding text objects.
  await ensureFontsLoaded();

  // Create (but don't show) the three overlay objects with sensible defaults.
  await createHeading();
  await createLogo();
  await createUrl();

  // Initial visibility from checkbox state (start hidden).
  headingOn.checked = false;
  logoOn.checked = false;
  urlOn.checked = false;
  syncVisibility();
  syncControls();
  updateMeta();
  fabricCanvas.requestRenderAll();
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function ensureFontsLoaded() {
  try {
    const sizes = ["48px", "24px"];
    const tasks = [];
    for (const { value } of FONT_FAMILIES) {
      for (const size of sizes) tasks.push(document.fonts.load(`600 ${size} "${value}"`));
    }
    await Promise.allSettled(tasks);
  } catch {}
}

async function createHeading() {
  const cw = fabricCanvas.width, ch = fabricCanvas.height;
  const text = (headingText.value || "Figure 1: Your Heading").trim();
  const size = parseInt(headingSize.value, 10) || 48;
  headingObj = new fabric.IText(text, {
    left: Math.round(cw * 0.03),
    top: Math.round(ch * 0.03),
    fontFamily: headingFont.value || "Inter",
    fontSize: size,
    fontWeight: textStyle.heading.bold ? 800 : 400,
    fontStyle: textStyle.heading.italic ? "italic" : "normal",
    underline: textStyle.heading.underline,
    fill: headingColor.value || "#1f2330",
    editable: true,
    selectable: true,
    hasControls: true,
    visible: false,
    objectCaching: false,
  });
  fabricCanvas.add(headingObj);
  updateToggleButtons();
}

async function createLogo() {
  const cw = fabricCanvas.width, ch = fabricCanvas.height;
  const targetHeight = parseInt(logoSize.value, 10) || 80;
  const src = customLogoDataUrl || "/vizuara-logo.png";
  try {
    const img = await loadImage(src);
    logoObj = new fabric.Image(img, {
      visible: false,
      left: Math.round(cw * 0.02),
      top: ch - targetHeight - Math.round(ch * 0.03),
      selectable: true,
      hasControls: true,
    });
    scaleLogoTo(targetHeight);
    fabricCanvas.add(logoObj);
  } catch {
    // Default logo not present — create a simple wordmark SVG as fallback and rasterize.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="120">
      <rect width="100%" height="100%" rx="16" fill="#1f2330"/>
      <text x="50%" y="60%" dominant-baseline="middle" text-anchor="middle"
            font-family="Inter, Arial, sans-serif" font-size="64" font-weight="800"
            fill="#ffffff" letter-spacing="6">VIZUARA</text>
    </svg>`;
    const img = await loadImage("data:image/svg+xml;utf8," + encodeURIComponent(svg));
    logoObj = new fabric.Image(img, {
      visible: false,
      left: Math.round(cw * 0.02),
      top: ch - targetHeight - Math.round(ch * 0.03),
      selectable: true,
      hasControls: true,
    });
    scaleLogoTo(targetHeight);
    fabricCanvas.add(logoObj);
  }
}

function scaleLogoTo(targetHeight) {
  if (!logoObj) return;
  const natural = logoObj.height;
  if (!natural) return;
  const s = targetHeight / natural;
  logoObj.scaleX = s;
  logoObj.scaleY = s;
  logoObj.setCoords();
}

async function createUrl() {
  const cw = fabricCanvas.width, ch = fabricCanvas.height;
  const text = (urlText.value || "vizuara.ai").trim();
  const size = parseInt(urlSize.value, 10) || 24;
  urlObj = new fabric.IText(text, {
    left: Math.round(cw * 0.12),
    top: ch - size * 2 - Math.round(ch * 0.03),
    fontFamily: urlFont.value || "Inter",
    fontSize: size,
    fontWeight: textStyle.url.bold ? 700 : 400,
    fontStyle: textStyle.url.italic ? "italic" : "normal",
    underline: textStyle.url.underline,
    fill: urlColor.value || "#1f2330",
    editable: true,
    selectable: true,
    hasControls: true,
    visible: false,
    objectCaching: false,
  });
  fabricCanvas.add(urlObj);
  updateToggleButtons();
}

function updateToggleButtons() {
  headingBoldBtn.classList.toggle("active", textStyle.heading.bold);
  headingItalicBtn.classList.toggle("active", textStyle.heading.italic);
  headingUnderlineBtn.classList.toggle("active", textStyle.heading.underline);
  urlBoldBtn.classList.toggle("active", textStyle.url.bold);
  urlItalicBtn.classList.toggle("active", textStyle.url.italic);
  urlUnderlineBtn.classList.toggle("active", textStyle.url.underline);
}

function applyTextStyle(which) {
  const obj = which === "heading" ? headingObj : urlObj;
  const s = textStyle[which];
  if (!obj) return;
  obj.set({
    fontWeight: s.bold ? (which === "heading" ? 800 : 700) : 400,
    fontStyle: s.italic ? "italic" : "normal",
    underline: !!s.underline,
  });
  fabricCanvas && fabricCanvas.requestRenderAll();
}

function syncVisibility() {
  if (headingObj) headingObj.visible = !!headingOn.checked;
  if (logoObj) logoObj.visible = !!logoOn.checked;
  if (urlObj) urlObj.visible = !!urlOn.checked;
  if (fabricCanvas) fabricCanvas.requestRenderAll();
}

function syncControls() {
  headingSizeVal.textContent = headingSize.value;
  logoSizeVal.textContent = logoSize.value;
  urlSizeVal.textContent = urlSize.value;
}

// -------- live control bindings --------
function wireEditorControls() {
  const persist = () => persistSession();

  headingOn.addEventListener("change", () => { syncVisibility(); persist(); });
  logoOn.addEventListener("change", () => { syncVisibility(); persist(); });
  urlOn.addEventListener("change", () => { syncVisibility(); persist(); });

  headingText.addEventListener("input", () => {
    if (!headingObj) return;
    headingObj.text = headingText.value;
    fabricCanvas.requestRenderAll();
    persist();
  });
  headingFont.addEventListener("change", async () => {
    if (!headingObj) return;
    await document.fonts.load(`800 48px "${headingFont.value}"`);
    headingObj.set("fontFamily", headingFont.value);
    fabricCanvas.requestRenderAll();
    persist();
  });
  headingSize.addEventListener("input", () => {
    headingSizeVal.textContent = headingSize.value;
    if (headingObj) {
      headingObj.set("fontSize", parseInt(headingSize.value, 10));
      fabricCanvas.requestRenderAll();
    }
    persist();
  });
  headingColor.addEventListener("input", () => {
    if (headingObj) {
      headingObj.set("fill", headingColor.value);
      fabricCanvas.requestRenderAll();
    }
    persist();
  });
  // Heading B/I/U toggles
  headingBoldBtn.addEventListener("click", () => {
    textStyle.heading.bold = !textStyle.heading.bold;
    applyTextStyle("heading"); updateToggleButtons(); persist();
  });
  headingItalicBtn.addEventListener("click", () => {
    textStyle.heading.italic = !textStyle.heading.italic;
    applyTextStyle("heading"); updateToggleButtons(); persist();
  });
  headingUnderlineBtn.addEventListener("click", () => {
    textStyle.heading.underline = !textStyle.heading.underline;
    applyTextStyle("heading"); updateToggleButtons(); persist();
  });

  // URL B/I/U toggles
  urlBoldBtn.addEventListener("click", () => {
    textStyle.url.bold = !textStyle.url.bold;
    applyTextStyle("url"); updateToggleButtons(); persist();
  });
  urlItalicBtn.addEventListener("click", () => {
    textStyle.url.italic = !textStyle.url.italic;
    applyTextStyle("url"); updateToggleButtons(); persist();
  });
  urlUnderlineBtn.addEventListener("click", () => {
    textStyle.url.underline = !textStyle.url.underline;
    applyTextStyle("url"); updateToggleButtons(); persist();
  });

  logoSize.addEventListener("input", () => {
    logoSizeVal.textContent = logoSize.value;
    scaleLogoTo(parseInt(logoSize.value, 10));
    fabricCanvas && fabricCanvas.requestRenderAll();
    persist();
  });
  logoFileInput.addEventListener("change", async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    if (file.size > 1_500_000) {
      setStatus("Logo file is > 1.5 MB; picking a smaller image is recommended so it fits in browser storage.", true);
    }
    const reader = new FileReader();
    reader.onload = async () => {
      customLogoDataUrl = reader.result;
      await replaceLogo(customLogoDataUrl);
      persist();
    };
    reader.readAsDataURL(file);
  });
  logoResetDefault.addEventListener("click", async () => {
    customLogoDataUrl = null;
    await replaceLogo("/vizuara-logo.png");
    persist();
  });

  urlText.addEventListener("input", () => {
    if (!urlObj) return;
    urlObj.text = urlText.value;
    fabricCanvas.requestRenderAll();
    persist();
  });
  urlFont.addEventListener("change", async () => {
    if (!urlObj) return;
    await document.fonts.load(`400 24px "${urlFont.value}"`);
    urlObj.set("fontFamily", urlFont.value);
    fabricCanvas.requestRenderAll();
    persist();
  });
  urlSize.addEventListener("input", () => {
    urlSizeVal.textContent = urlSize.value;
    if (urlObj) {
      urlObj.set("fontSize", parseInt(urlSize.value, 10));
      fabricCanvas.requestRenderAll();
    }
    persist();
  });
  urlColor.addEventListener("input", () => {
    if (urlObj) {
      urlObj.set("fill", urlColor.value);
      fabricCanvas.requestRenderAll();
    }
    persist();
  });

  editorResetBtn.addEventListener("click", resetEditorLayout);
  downloadEl.addEventListener("click", downloadCurrentCanvas);
}

async function replaceLogo(src) {
  if (!fabricCanvas) return;
  const prevLeft = logoObj ? logoObj.left : null;
  const prevTop = logoObj ? logoObj.top : null;
  if (logoObj) fabricCanvas.remove(logoObj);
  try {
    const img = await loadImage(src);
    const W = fabricCanvas.width, H = fabricCanvas.height;
    const targetHeight = parseInt(logoSize.value, 10) || 80;
    logoObj = new fabric.Image(img, {
      left: prevLeft != null ? prevLeft : Math.round(W * 0.02),
      top: prevTop != null ? prevTop : H - targetHeight - Math.round(H * 0.025),
      visible: !!logoOn.checked,
      selectable: true,
      hasControls: true,
    });
    scaleLogoTo(targetHeight);
    fabricCanvas.add(logoObj);
    fabricCanvas.requestRenderAll();
  } catch (e) {
    setStatus("Could not load logo: " + e.message, true);
  }
}

function resetEditorLayout() {
  if (selectedIdx < 0) return;
  loadImageIntoEditor(currentIterations[selectedIdx]);
}

function downloadCurrentCanvas() {
  if (!fabricCanvas) return;
  // Export at the ORIGINAL image resolution, regardless of how the canvas
  // is displayed. baseImgScale = displayWidth / originalWidth, so multiplying
  // by 1/baseImgScale upscales the rendering pipeline back to native pixels.
  // Fabric renders HTMLImageElements from their natural pixel data, so the
  // base image is lossless; text and the logo raster get re-rendered at the
  // multiplied size (still crisp because text is vector and logo source pixels
  // are untouched).
  const multiplier = baseImgScale > 0 ? 1 / baseImgScale : 1;
  const dataUrl = fabricCanvas.toDataURL({
    format: "png",
    multiplier,
    enableRetinaScaling: false,
  });
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = `paperbanana-${Date.now()}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();

  const finalW = Math.round(fabricCanvas.width * multiplier);
  const finalH = Math.round(fabricCanvas.height * multiplier);
  setStatus(`Downloaded at native resolution: ${finalW} × ${finalH}.`);
}

// -------- wire up --------
genBtn.addEventListener("click", generate);
resetBtn.addEventListener("click", resetDefaults);
clearSessionBtn.addEventListener("click", () => {
  if (confirm("Clear the saved session? This removes the stored images and editor state from this browser. Consider Download backup first.")) {
    clearSavedSession();
  }
});
exportBackupBtn.addEventListener("click", downloadBackup);
importBackupInput.addEventListener("change", (ev) => {
  const f = ev.target.files && ev.target.files[0];
  if (f) handleBackupImport(f);
  ev.target.value = "";
});
descEl.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") generate();
});
// Persist basic input changes so refresh doesn't lose the description itself.
["input", "change"].forEach((ev) => {
  descEl.addEventListener(ev, persistSession);
});
[styleEl, densityEl, ratioEl, itersEl, modelEl].forEach((el) => el.addEventListener("change", persistSession));

(async function boot() {
  initEditorControlsOnce();
  wireEditorControls();
  await loadMe();
  await loadConfig();
  await restoreSession();
})();
