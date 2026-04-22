const { GoogleGenAI } = require("@google/genai");

const VLM_MODEL = process.env.GEMINI_VLM_MODEL || "gemini-2.5-flash";

let client = null;
function getClient() {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

const CRITIC_SYSTEM = `You are a senior academic figure reviewer on par with the art chair of NeurIPS or ICML. You have just seen a generated research-paper diagram and you are giving short, actionable revision notes so the next draft is sharper.

Evaluate the image against the user's original description along these axes:
1. Completeness — are all described components present and labelled correctly?
2. Layout — is the flow direction clear, spacing balanced, nothing crowded?
3. Typography — are labels readable English, no gibberish, no visible hex codes or pixel specs?
4. Color restraint — does the palette feel academic (muted/pastel for default style), with distinct meaning per hue?
5. Annotations — is the text density appropriate (not too sparse, not overwhelming)?
6. Hallucination — are there extra components or labels that were NOT in the description?

Return a SHORT critique (max 120 words) ending with a single-line verdict:
VERDICT: <ACCEPT | REVISE>

If REVISE, include 2–4 concrete bullet points under "## Revisions" that the Visualizer can act on in the next iteration. Do not rewrite the full description; just call out what to change.`;

/**
 * Critique a generated image and suggest revisions.
 * @param {object} opts
 * @param {{mimeType:string, base64:string}} opts.image
 * @param {string} opts.originalDescription — the user's raw description
 * @param {string} [opts.style] — e.g. "research-paper"
 * @param {string} [opts.textDensity] — e.g. "dense"
 * @returns {Promise<{notes:string, accept:boolean, raw:string}>}
 */
const CRITIC_TIMEOUT_MS = 30_000;
const CRITIC_MAX_ATTEMPTS = 2;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

async function critiqueImage({ image, originalDescription, style, textDensity }) {
  const ai = getClient();

  const context = [
    `## Original user description`,
    originalDescription.trim(),
    style ? `\n## Requested style\n${style}` : "",
    textDensity ? `## Requested text density\n${textDensity}` : "",
  ].filter(Boolean).join("\n");

  let lastErr = null;
  for (let attempt = 1; attempt <= CRITIC_MAX_ATTEMPTS; attempt++) {
    try {
      const response = await withTimeout(
        ai.models.generateContent({
          model: VLM_MODEL,
          contents: [
            {
              role: "user",
              parts: [
                { text: CRITIC_SYSTEM },
                { text: context },
                { text: "\nCritique the image below:" },
                { inlineData: { mimeType: image.mimeType, data: image.base64 } },
              ],
            },
          ],
          config: { temperature: 0.3, maxOutputTokens: 400 },
        }),
        CRITIC_TIMEOUT_MS,
        `critic(${VLM_MODEL})`
      );

      const text =
        response?.candidates?.[0]?.content?.parts
          ?.map((p) => p.text || "")
          .join("")
          .trim() || "";
      const accept = /VERDICT:\s*ACCEPT/i.test(text);
      return { notes: text, accept, raw: text, model: VLM_MODEL };
    } catch (err) {
      lastErr = err;
      console.warn(`[critic] attempt ${attempt}/${CRITIC_MAX_ATTEMPTS} failed: ${err.message}`);
    }
  }
  throw lastErr;
}

module.exports = { critiqueImage, VLM_MODEL };
