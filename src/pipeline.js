const { generateImage } = require("./gemini");
const { critiqueImage } = require("./critic");
const { buildImagePrompt } = require("./prompts");

/**
 * Run the PaperBanana-style multi-iteration pipeline:
 *   Visualizer → Critic → Visualizer → Critic → Visualizer
 * (3 images, 2 critiques between them.)
 *
 * Each iteration after the first incorporates the previous critic's revision notes
 * into the prompt so the image improves.
 *
 * Emits events via `onEvent(event)` so callers (e.g. an HTTP streaming endpoint)
 * can forward progress to the client:
 *   { type: "start", totalIterations }
 *   { type: "gen:start", iteration }
 *   { type: "gen:done", iteration, image, generationMs }
 *   { type: "critic:start", iteration }
 *   { type: "critic:done", iteration, critique, critiqueMs }
 *   { type: "critic:error", iteration, error }
 *   { type: "done", totalMs }
 *
 * @param {object} opts
 * @param {string} opts.description
 * @param {string} [opts.aspectRatio]
 * @param {string} [opts.style]
 * @param {string} [opts.textDensity]
 * @param {number} [opts.iterations=3]
 * @param {boolean} [opts.stopOnAccept=false]
 * @param {(event:object)=>void} [opts.onEvent]
 * @returns {Promise<{iterations:Array<{image,critique,durationMs,model}>, totalMs:number}>}
 */
async function runPipeline({
  description,
  aspectRatio,
  style,
  textDensity,
  colorTheme,
  model,
  iterations = 3,
  stopOnAccept = false,
  onEvent = () => {},
}) {
  const started = Date.now();
  const results = [];
  let revisionNotes = null;

  onEvent({ type: "start", totalIterations: iterations });

  for (let i = 0; i < iterations; i++) {
    const iterNumber = i + 1;
    const iterStart = Date.now();

    const descWithNotes = revisionNotes
      ? `${description}\n\n## Revisions requested for this iteration\n${revisionNotes}`
      : description;

    onEvent({ type: "gen:start", iteration: iterNumber });
    const img = await generateImage({
      description: descWithNotes,
      aspectRatio,
      style,
      textDensity,
      colorTheme,
      model,
    });
    const genMs = Date.now() - iterStart;
    onEvent({
      type: "gen:done",
      iteration: iterNumber,
      image: { mimeType: img.mimeType, base64: img.base64, model: img.model },
      generationMs: genMs,
    });

    let critique = null;
    if (i < iterations - 1) {
      const critStart = Date.now();
      onEvent({ type: "critic:start", iteration: iterNumber });
      try {
        critique = await critiqueImage({
          image: { mimeType: img.mimeType, base64: img.base64 },
          originalDescription: description,
          style,
          textDensity,
        });
        revisionNotes = critique.notes;
        onEvent({
          type: "critic:done",
          iteration: iterNumber,
          critique: { notes: critique.notes, accept: critique.accept, model: critique.model },
          critiqueMs: Date.now() - critStart,
        });
        if (stopOnAccept && critique.accept) {
          results.push({
            iteration: iterNumber,
            image: img,
            critique,
            durationMs: Date.now() - iterStart,
            generationMs: genMs,
          });
          break;
        }
      } catch (err) {
        console.error(`[pipeline] critic failed on iter ${iterNumber}:`, err.message);
        onEvent({ type: "critic:error", iteration: iterNumber, error: err.message });
      }
    }

    results.push({
      iteration: iterNumber,
      image: img,
      critique,
      durationMs: Date.now() - iterStart,
      generationMs: genMs,
    });
  }

  const totalMs = Date.now() - started;
  onEvent({ type: "done", totalMs });
  return { iterations: results, totalMs };
}

module.exports = { runPipeline };
