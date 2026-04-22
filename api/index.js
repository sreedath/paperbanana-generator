// Vercel serverless entrypoint. Wraps the Express app.
// PUBLIC_URL falls back to the Vercel-provided preview/prod URL.
if (!process.env.PUBLIC_URL && process.env.VERCEL_URL) {
  process.env.PUBLIC_URL = `https://${process.env.VERCEL_URL}`;
}

const { createApp } = require("../src/app");

module.exports = createApp();
