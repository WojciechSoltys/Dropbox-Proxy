// api/_dbx_auth.js (ESM)
// Auto-odświeżanie access tokenu z refresh tokena Dropbox.

import fetch from "node-fetch";

const TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";

// Prosta cache'ka w pamięci funkcji (żyje przez krótki czas na serwerless)
let cached = { token: null, exp: 0 };

export async function getAccessToken() {
  // Jeżeli mamy ważny token w cache – użyj.
  if (cached.token && Date.now() < cached.exp) return cached.token;

  const clientId = process.env.DBX_CLIENT_ID;
  const clientSecret = process.env.DBX_CLIENT_SECRET;
  const refreshToken = process.env.DBX_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Brak DBX_CLIENT_ID/DBX_CLIENT_SECRET/DBX_REFRESH_TOKEN w env.");
  }

  // OAuth2 Refresh Token Flow
  const body = new URLSearchParams();
  body.set("grant_type", "refresh_token");
  body.set("refresh_token", refreshToken);
  body.set("client_id", clientId);
  body.set("client_secret", clientSecret);

  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Dropbox token refresh failed: ${r.status} ${t}`);
  }

  const json = await r.json();
  const access = json.access_token;
  const expires = json.expires_in || 14400; // Dropbox zwykle ~4h
  cached = {
    token: access,
    exp: Date.now() + (expires - 60) * 1000 // odśwież 1 min przed upływem
  };

  return access;
}

// Helper: pobierz Bearer – użyj nagłówka jeśli jest, inaczej odśwież z refresh tokena
export async function resolveAuth(req) {
  const hdr = req.headers.authorization;
  if (hdr && hdr.startsWith("Bearer ")) return hdr;

  const t = await getAccessToken();
  return `Bearer ${t}`;
}
