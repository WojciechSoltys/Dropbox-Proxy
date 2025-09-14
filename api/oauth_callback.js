// api/oauth_callback.js
import fetch from "node-fetch";

export default async function handler(req, res) {
  try {
    const { code } = req.query || {};
    if (!code) {
      return res.status(400).send("Missing ?code=…");
    }

    const clientId = process.env.DBX_CLIENT_ID;
    const clientSecret = process.env.DBX_CLIENT_SECRET;
    const redirectUri = "https://dropbox-proxy-three.vercel.app/api/oauth_callback";

    const body = new URLSearchParams();
    body.set("code", code);
    body.set("grant_type", "authorization_code");
    body.set("client_id", clientId);
    body.set("client_secret", clientSecret);
    body.set("redirect_uri", redirectUri);
    body.set("token_access_type", "offline"); // prosimy o refresh_token

    const r = await fetch("https://api.dropboxapi.com/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });

    const text = await r.text();
    if (!r.ok) {
      return res.status(500).send("Token exchange failed: " + text);
    }

    // Wyświetl w przeglądarce, by łatwo skopiować refresh_token:
    res.setHeader("Content-Type", "text/html; charset=UTF-8");
    return res.status(200).send(`
      <h2>Dropbox OAuth OK</h2>
      <pre>${text.replace(/</g, "&lt;")}</pre>
      <p><b>Skopiuj 'refresh_token'</b> z powyższego JSON i wklej w Vercel → Environment Variables jako <code>DBX_REFRESH_TOKEN</code>.</p>
    `);
  } catch (e) {
    return res.status(500).send("Error: " + (e?.message || String(e)));
  }
}
