export default function handler(req, res) {
  res.status(200).json({ ok: true, path: req.url, time: new Date().toISOString() });
}
