import fetch from "node-fetch";
import { resolveAuth } from "./_dbx_auth.js";

const ALLOWED = (process.env.ALLOWED_PREFIXES || "/Warsztat Opiniowy/Wytyczne|/Warsztat Opiniowy/Skany")
  .split("|").map(s => s.trim()).filter(Boolean);
const isAllowed = p => typeof p === "string" && ALLOWED.some(pref => p.startsWith(pref));

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const { query, options } = req.body || {};
    if (!query || !options?.path) {
      return res.status(400).json({ error: "Missing 'query' or 'options.path' in body" });
    }
    if (!isAllowed(options.path)) {
      return res.status(403).json({ error: "Path not allowed by whitelist", allowed_prefixes: ALLOWED });
    }

    const auth = await resolveAuth(req);

    const r = await fetch("https://api.dropboxapi.com/2/files/search_v2", {
      method: "POST",
      headers: { "Authorization": auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        options: {
          ...options,
          max_results: options?.max_results || 100
        }
      })
    });

    const json = await r.json().catch(() => ({}));
    return res.status(r.ok ? 200 : r.status).json(json);
  } catch (e) {
    console.error("search_v2 error:", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
}
