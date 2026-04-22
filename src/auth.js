const passport = require("passport");
const { Strategy: GoogleStrategy } = require("passport-google-oauth20");

function parseAllowedEmails() {
  const raw = process.env.ALLOWED_EMAILS || "";
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

function configurePassport() {
  // Accept either naming for the OAuth client credentials.
  const clientID = process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const publicUrl = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;

  if (!clientID || !clientSecret) {
    console.warn("[auth] GOOGLE_CLIENT_ID / SECRET not set — /auth/google will 500 until configured");
  }

  passport.serializeUser((user, done) => done(null, user));
  passport.deserializeUser((user, done) => done(null, user));

  passport.use(
    new GoogleStrategy(
      {
        clientID: clientID || "missing",
        clientSecret: clientSecret || "missing",
        callbackURL: `${publicUrl}/auth/google/callback`,
      },
      (accessToken, refreshToken, profile, done) => {
        const email = (profile.emails?.[0]?.value || "").toLowerCase();
        const allowed = parseAllowedEmails();
        if (!email || !allowed.includes(email)) {
          return done(null, false, { message: "unauthorized" });
        }
        return done(null, {
          id: profile.id,
          email,
          displayName: profile.displayName,
          photo: profile.photos?.[0]?.value,
        });
      }
    )
  );
}

function ensureAuthed(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  if (req.path.startsWith("/api/")) {
    return res.status(401).json({ error: "unauthenticated" });
  }
  return res.redirect("/login");
}

module.exports = { configurePassport, ensureAuthed, parseAllowedEmails };
