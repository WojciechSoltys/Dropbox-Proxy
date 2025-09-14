// api/oauth_callback.js
// Wymiana authorization_code -> access_token + refresh_token (ESM)

import fetch from "node-fetch";

const REDIRECT_URI = "https://dropbox-proxy-three.vercel.app/api/oauth_callback"; // <- jeśli masz inny host, podmień

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") return res.status(405).send("Method not allowed");

    const { code, error, error_description } = req.query || {};
    if (error) return res.status(400).send(`OAuth error: ${error} ${error_description || ""}`);
    if (!code) return res.status(400).send("Missing ?code=… (wróć tu po kliknięciu 'Allow' w Dropbox)");

    const clientId = process.env.DBX_CLIENT_ID;
    const clientSecret = process.env.DBX_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return res.status(500).send("Brak DBX_CLIENT_ID / DBX_CLIENT_SECRET w env (Vercel → Settings → Environment Variables).");
    }

    const body = new URLSearchParams();
    body.set("code", code);
    body.set("grant_type", "authorization_code");
    body.set("client_id", clientId);
    body.set("client_secret", clientSecret);
    body.set("redirect_uri", REDIRECT_URI);
    body.set("token_access_type", "offline"); // potrzebujemy refresh_token

    const r = await fetch("https://api.dropboxapi.com/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });

    const text = await r.text();
    if (!r.ok) {
      res.setHeader("Content-Type", "text/plain; charset=UTF-8");
      return res.status(500).send("Token exchange failed:\n" + text);
    }

    // Pokaż JSON wygodnie w przeglądarce:
    res.setHeader("Content-Type", "text/html; charset=UTF-8");
    return res.status(200).send(`
      <h2>Dropbox OAuth — sukces</h2>
      <p>Skopiuj <code>refresh_token</code> z JSON poniżej i wklej do Vercel → Settings → Environment Variables jako <b>DBX_REFRESH_TOKEN</b>.</p>
      <pre style="white-space:pre-wrap;word-break:break-word;">${text.replace(/</g, "&lt;")}</pre>
    `);
  } catch (e) {
    return res.status(500).send("Error: " + (e?.message || String(e)));
  }
}
