import fetch from "node-fetch";

// Domyślne dozwolone prefiksy (możesz nadpisać env: ALLOWED_PREFIXES="/A|/B")
const ALLOWED = (process.env.ALLOWED_PREFIXES || "/Warsztat Opiniowy/Wytyczne|/Warsztat Opiniowy/Skany").split("|");
const isAllowed = p => ALLOWED.some(pref => p?.startsWith(pref));

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const { path, recursive = false, limit = 2000 } = req.body || {};
    if (!path) return res.status(400).json({ error: "Missing body param: path" });
    if (!isAllowed(path)) return res.status(403).json({ error: "Path not allowed", allowed_prefixes: ALLOWED });

    const auth = req.headers.authorization || `Bearer ${process.env.DROPBOX_TOKEN}`;
    if (!auth?.startsWith("Bearer ")) return res.status(401).json({ error: "Missing Bearer token" });

    const r = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
      method: "POST",
      headers: { "Authorization": auth, "Content-Type": "application/json" },
      body: JSON.stringify({ path, recursive, limit })
    });

    const json = await r.json().catch(() => ({}));
    return res.status(r.ok ? 200 : r.status).json(json);
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
}
