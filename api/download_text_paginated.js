import fetch from "node-fetch";
import mammoth from "mammoth";
import pdf from "pdf-parse/lib/pdf-parse.js";
import * as XLSX from "xlsx";
import chardet from "chardet";
import iconv from "iconv-lite";
import { htmlToText } from "html-to-text";

const ALLOWED = (process.env.ALLOWED_PREFIXES || "/Warsztat Opiniowy/Wytyczne|/Warsztat Opiniowy/Skany").split("|");
const isAllowed = p => ALLOWED.some(pref => p?.startsWith(pref));
const EXT_TEXT = new Set(["txt","md","csv","json","html","htm"]);
const MAX_BYTES_HARD = 10_000_000;

function ext(path="") { const i = path.lastIndexOf("."); return i<0?"":path.slice(i+1).toLowerCase(); }
function decodeBuf(buf) {
  const guess = chardet.detect(buf) || "UTF-8";
  try {
    if (/utf-?8/i.test(guess)) return buf.toString("utf8");
    if (/windows-1250|cp1250/i.test(guess)) return iconv.decode(buf, "win1250");
    return iconv.decode(buf, guess);
  } catch { return buf.toString("utf8"); }
}
function splitByChars(s, chunkSize, idx) {
  const total = Math.max(1, Math.ceil(s.length / chunkSize));
  const safeIdx = Math.min(Math.max(0, idx), total - 1);
  const start = safeIdx * chunkSize;
  const end = Math.min(s.length, start + chunkSize);
  return { chunk: s.slice(start, end), chunk_index: safeIdx, total_chunks: total };
}
function encodeCursor(obj) { return Buffer.from(JSON.stringify(obj)).toString("base64"); }
function decodeCursor(cur) { try { return JSON.parse(Buffer.from(cur, "base64").toString("utf8")); } catch { return null; } }

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

    const { path, cursor, chunk_size = "40000", chunk_index = "0", format = "text",
            sheet, row_offset = "0", row_limit = "1000" } = req.query;

    let p = path, idx = parseInt(chunk_index,10)||0, size = Math.max(1000, Math.min(parseInt(chunk_size,10)||40000, 150000));
    let ro = Math.max(0, parseInt(row_offset,10)||0), rl = Math.max(1, Math.min(parseInt(row_limit,10)||1000, 5000));

    if (cursor && !p) {
      const c = decodeCursor(cursor);
      if (!c?.path) return res.status(400).json({ error: "Invalid cursor" });
      p = c.path;
      if (typeof c.chunk_index === "number") idx = c.chunk_index;
      if (typeof c.chunk_size === "number") size = c.chunk_size;
      if (typeof c.row_offset === "number") ro = c.row_offset;
      if (typeof c.row_limit === "number") rl = c.row_limit;
      if (c.sheet) c.sheet && (c.sheet === "null" ? null : c.sheet);
    }

    if (!p) return res.status(400).json({ error: "Missing 'path' or 'cursor'" });
    if (!isAllowed(p)) return res.status(403).json({ error: "Path not allowed", allowed_prefixes: ALLOWED });

    const auth = req.headers.authorization || `Bearer ${process.env.DROPBOX_TOKEN}`;
    if (!auth?.startsWith("Bearer ")) return res.status(401).json({ error: "Missing Bearer token" });

    // Pobranie binariów
    const r = await fetch("https://content.dropboxapi.com/2/files/download", {
      method: "POST",
      headers: { "Authorization": auth, "Dropbox-API-Arg": JSON.stringify({ path: p }) }
    });
    if (!r.ok) {
      const body = await r.text().catch(()=> "");
      return res.status(502).json({ error: "Dropbox error", status: r.status, body });
    }

    let metadata = {};
    try { metadata = JSON.parse(r.headers.get("Dropbox-API-Result") || "{}"); } catch {}
    const buf = Buffer.from(await r.arrayBuffer());
    const hardTrunc = buf.length > MAX_BYTES_HARD;
    const slice = hardTrunc ? buf.subarray(0, MAX_BYTES_HARD) : buf;
    const e = ext(p);

    // Teksty
    if (EXT_TEXT.has(e)) {
      let text = decodeBuf(slice);
      if (e === "html" || e === "htm") text = htmlToText(text, { wordwrap: false, selectors: [{ selector: "a", options: { ignoreHref: true } }] });
      const { chunk, chunk_index, total_chunks } = splitByChars(text, size, idx);
      const has_more = chunk_index < total_chunks - 1;
      const next_cursor = has_more ? encodeCursor({ path: p, chunk_index: chunk_index + 1, chunk_size: size }) : null;
      return res.json({ metadata, type: "text", encoding: "utf-8", content_text: chunk, chunk_index, total_chunks, has_more, next_cursor, hard_truncated: hardTrunc });
    }

    // DOCX
    if (e === "docx") {
      try {
        const { value } = await mammoth.extractRawText({ buffer: slice });
        const text = value || "";
        const { chunk, chunk_index, total_chunks } = splitByChars(text, size, idx);
        const has_more = chunk_index < total_chunks - 1;
        const next_cursor = has_more ? encodeCursor({ path: p, chunk_index: chunk_index + 1, chunk_size: size }) : null;
        return res.json({ metadata, type: "docx", encoding: "utf-8", content_text: chunk, chunk_index, total_chunks, has_more, next_cursor, hard_truncated: hardTrunc });
      } catch {
        return res.json({ metadata, type: "docx", needs_conversion: true, note: "DOCX parse failed", encoding: "base64", content_base64: slice.toString("base64") });
      }
    }

    // PDF (bez OCR)
    if (e === "pdf") {
      try {
        const parsed = await pdfParse(slice);
        const text = parsed.text || "";
        const { chunk, chunk_index, total_chunks } = splitByChars(text, size, idx);
        const has_more = chunk_index < total_chunks - 1;
        const next_cursor = has_more ? encodeCursor({ path: p, chunk_index: chunk_index + 1, chunk_size: size }) : null;
        return res.json({ metadata, type: "pdf", pages_detected: parsed.numpages, encoding: "utf-8", content_text: chunk, chunk_index, total_chunks, has_more, next_cursor, hard_truncated: hardTrunc, note: "Chunking by characters (not exact pages). For scans: OCR required." });
      } catch {
        return res.json({ metadata, type: "pdf", needs_conversion: true, note: "PDF parse failed or scanned PDF; OCR required", encoding: "base64", content_base64: slice.toString("base64") });
      }
    }

    // XLSX → porcje wierszy jako CSV
    if (e === "xlsx") {
      try {
        const wb = XLSX.read(slice, { type: "buffer" });
        const sheets = wb.SheetNames || [];
        let target = sheets[0];
        if (sheet) {
          if (sheets.includes(sheet)) target = sheet;
          else if (!isNaN(+sheet) && sheets[+sheet]) target = sheets[+sheet];
        }
        const ws = wb.Sheets[target];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
        const total_rows = rows.length;
        const start = Math.min(ro, Math.max(0, total_rows));
        const end = Math.min(total_rows, start + rl);
        const sliceRows = rows.slice(start, end);

        const has_more = end < total_rows;
        const next_cursor = has_more ? encodeCursor({ path: p, row_offset: end, row_limit: rl, sheet: target }) : null;

        const csv = sliceRows.map(r => r.map(v => {
          if (v == null) return "";
          const s = String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
        }).join(",")).join("\n");

        return res.json({
          metadata, type: "xlsx", sheet: target, total_rows, row_offset: start, row_limit: rl,
          has_more, next_cursor, encoding: "utf-8", content_text: csv, format: "csv", sheets
        });
      } catch {
        return res.json({ metadata, type: "xlsx", needs_conversion: true, note: "XLSX parse failed", encoding: "base64", content_base64: slice.toString("base64") });
      }
    }

    // Inne formaty → tylko sygnał konwersji
    return res.json({ metadata, type: e || "unknown", needs_conversion: true, note: "Unsupported format. Provide text/converted file.", encoding: "base64", content_base64: slice.toString("base64") });

  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
}
