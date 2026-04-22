require("dotenv").config();

const { createApp } = require("./src/app");
const { parseAllowedEmails } = require("./src/auth");

const PORT = parseInt(process.env.PORT || "3000", 10);
const app = createApp();

app.listen(PORT, () => {
  const allowed = parseAllowedEmails();
  console.log(`[paperbanana] listening on :${PORT}`);
  console.log(`[paperbanana] allowed emails: ${allowed.length ? allowed.join(", ") : "(none — auth will reject all)"}`);
});
