// ESM + limity per format + paginacja + raw=true + odświeżanie tokenu
import fetch from "node-fetch";
import mammoth from "mammoth";
import pdf from "pdf-parse/lib/pdf-parse.js";
import * as XLSX from "xlsx";
import chardet from "chardet";
import iconv from "iconv-lite";
import { htmlToText } from "html-to-text";
import { resolveAuth } from "./_dbx_auth.js";

const ALLOWED = (process.env.ALLOWED_PREFIXES || "/Warsztat Opiniowy/Wytyczne|/Warsztat Opiniowy/Skany")
  .split("|").map(s => s.trim()).filter(Boolean);
const isAllowed = p => typeof p === "string" && ALLOWED.some(pref => p.startsWith(pref));

const MAX_BYTES_TEXT = 10_000_000;  // txt/md/csv/json/html
const MAX_BYTES_DOCX = 25_000_000;  // kontenery parsujemy w całości
const MAX_BYTES_PDF  = 25_000_000;
const MAX_BYTES_XLSX = 25_000_000;

const EXT_TEXT = new Set(["txt", "md", "csv", "json", "html", "htm"]);
const ext = (path = "") => { const i = path.lastIndexOf("."); return i < 0 ? "" : path.slice(i + 1).toLowerCase(); };

const decodeBuf = (buf) => {
  const guess = chardet.detect(buf) || "UTF-8";
  try {
    if (/utf-?8/i.test(guess)) return buf.toString("utf8");
    if (/windows-1250|cp1250/i.test(guess)) return iconv.decode(buf, "win1250");
    return iconv.decode(buf, guess);
  } catch {
    return buf.toString("utf8");
  }
};

const splitByChars = (s, chunkSize, idx) => {
  const total = Math.max(1, Math.ceil(s.length / chunkSize));
  const safeIdx = Math.min(Math.max(0, idx), total - 1);
  const start = safeIdx * chunkSize;
  const end = Math.min(s.length, start + chunkSize);
  return { chunk: s.slice(start, end), chunk_index: safeIdx, total_chunks: total };
};

const encodeCursor = obj => Buffer.from(JSON.stringify(obj)).toString("base64");
const decodeCursor = cur => { try { return JSON.parse(Buffer.from(cur, "base64").toString("utf8")); } catch { return null; } };

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

    const {
      path,
      cursor,
      chunk_size = "40000",
      chunk_index = "0",
      format = "text",   // xlsx: "text"->CSV, "json"->JSON wierszy
      sheet,
      row_offset = "0",
      row_limit = "1000",
      raw = "false"
    } = req.query || {};

    // Cursor → parametry
    let p = path;
    let idx = parseInt(chunk_index, 10) || 0;
    let size = Math.max(1000, Math.min(parseInt(chunk_size, 10) || 40000, 150000));
    let ro = Math.max(0, parseInt(row_offset, 10) || 0);
    let rl = Math.max(1, Math.min(parseInt(row_limit, 10) || 1000, 5000));
    let sheetOverride = sheet;

    if (cursor && !p) {
      const c = decodeCursor(cursor);
      if (!c?.path) return res.status(400).json({ error: "Invalid cursor" });
      p = c.path;
      if (typeof c.chunk_index === "number") idx = c.chunk_index;
      if (typeof c.chunk_size === "number") size = c.chunk_size;
      if (typeof c.row_offset === "number") ro = c.row_offset;
      if (typeof c.row_limit === "number") rl = c.row_limit;
      if (typeof c.sheet === "string") sheetOverride = c.sheet;
    }

    if (!p) return res.status(400).json({ error: "Missing 'path' or 'cursor'" });
    if (!isAllowed(p)) {
      return res.status(403).json({ error: "Path not allowed by whitelist", allowed_prefixes: ALLOWED });
    }

    const auth = await resolveAuth(req);

    // Pobierz plik
    const r = await fetch("https://content.dropboxapi.com/2/files/download", {
      method: "POST",
      headers: { "Authorization": auth, "Dropbox-API-Arg": JSON.stringify({ path: p }) }
    });
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      return res.status(502).json({ error: "Dropbox error", status: r.status, body });
    }

    // Metadane
    let metadata = {};
    try { metadata = JSON.parse(r.headers.get("Dropbox-API-Result") || "{}"); } catch {}

    const buf = Buffer.from(await r.arrayBuffer());
    const e = ext(p);

    // Limity dla kontenerów (bez cięcia na wejściu)
    if (e === "docx" && buf.length > MAX_BYTES_DOCX) {
      return res.status(413).json({ error: "DOCX too large", size_bytes: buf.length, limit_bytes: MAX_BYTES_DOCX });
    }
    if (e === "pdf" && buf.length > MAX_BYTES_PDF) {
      return res.status(413).json({ error: "PDF too large", size_bytes: buf.length, limit_bytes: MAX_BYTES_PDF });
    }
    if (e === "xlsx" && buf.length > MAX_BYTES_XLSX) {
      return res.status(413).json({ error: "XLSX too large", size_bytes: buf.length, limit_bytes: MAX_BYTES_XLSX });
    }

    // raw=true → bez parsowania (diagnostyka)
    const wantRaw = String(raw).toLowerCase() === "true";
    if (wantRaw) {
      return res.json({
        metadata, type: e || "unknown", encoding: "base64",
        content_base64: buf.toString("base64"),
        note: "raw=true: returned base64 without parsing.",
        hard_truncated: false
      });
    }

    // Tnij TYLKO proste teksty na wejściu
    const hardTrunc = (EXT_TEXT.has(e) && buf.length > MAX_BYTES_TEXT);
    const slice = hardTrunc ? buf.subarray(0, MAX_BYTES_TEXT) : buf;

    // Teksty
    if (EXT_TEXT.has(e)) {
      let text = decodeBuf(slice);
      if (e === "html" || e === "htm") {
        text = htmlToText(text, { wordwrap: false, selectors: [{ selector: "a", options: { ignoreHref: true } }] });
      }
      const { chunk, chunk_index, total_chunks } = splitByChars(text, size, idx);
      const has_more = chunk_index < total_chunks - 1;
      const next_cursor = has_more ? encodeCursor({ path: p, chunk_index: chunk_index + 1, chunk_size: size }) : null;

      return res.json({
        metadata, type: "text", encoding: "utf-8",
        content_text: chunk, chunk_index, total_chunks,
        has_more, next_cursor, hard_truncated: hardTrunc
      });
    }

    // DOCX
    if (e === "docx") {
      try {
        const { value } = await mammoth.extractRawText({ buffer: slice }); // pełny bufor docx
        const text = value || "";
        const { chunk, chunk_index, total_chunks } = splitByChars(text, size, idx);
        const has_more = chunk_index < total_chunks - 1;
        const next_cursor = has_more ? encodeCursor({ path: p, chunk_index: chunk_index + 1, chunk_size: size }) : null;

        return res.json({
          metadata, type: "docx", encoding: "utf-8",
          content_text: chunk, chunk_index, total_chunks,
          has_more, next_cursor, hard_truncated: false
        });
      } catch (err) {
        return res.json({
          metadata, type: "docx", needs_conversion: true,
          note: `DOCX parse failed (maybe .doc or corrupted). ${err?.message || ""}`.trim(),
          encoding: "base64", content_base64: slice.toString("base64")
        });
      }
    }

    // PDF (bez OCR)
    if (e === "pdf") {
      try {
        const data = Buffer.isBuffer(slice) ? slice : Buffer.from(slice);
        if (!data || data.length === 0) {
          return res.status(422).json({ error: "Empty PDF buffer (nothing to parse)" });
        }

        const parsed = await pdf(data);
        const text = parsed?.text || "";
        const { chunk, chunk_index, total_chunks } = splitByChars(text, size, idx);
        const has_more = chunk_index < total_chunks - 1;
        const next_cursor = has_more ? encodeCursor({ path: p, chunk_index: chunk_index + 1, chunk_size: size }) : null;

        return res.json({
          metadata, type: "pdf", pages_detected: parsed?.numpages,
          encoding: "utf-8", content_text: chunk,
          chunk_index, total_chunks, has_more, next_cursor, hard_truncated: false
        });
      } catch (err) {
        return res.json({
          metadata, type: "pdf", needs_conversion: true,
          note: `PDF parse failed or scanned PDF; OCR required. ${err?.message || ""}`.trim(),
          encoding: "base64", content_base64: slice.toString("base64")
        });
      }
    }

    // XLSX → CSV/JSON w porcjach
    if (e === "xlsx") {
      try {
        const wb = XLSX.read(slice, { type: "buffer" });
        const sheets = wb.SheetNames || [];
        let target = sheets[0];
        if (sheetOverride) {
          if (sheets.includes(sheetOverride)) target = sheetOverride;
          else if (!isNaN(+sheetOverride) && sheets[+sheetOverride]) target = sheets[+sheetOverride];
        }
        const ws = wb.Sheets[target];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
        const total_rows = rows.length;
        const start = Math.min(ro, Math.max(0, total_rows));
        const end = Math.min(total_rows, start + rl);
        const sliceRows = rows.slice(start, end);

        const has_more = end < total_rows;
        const next_cursor = has_more ? encodeCursor({ path: p, row_offset: end, row_limit: rl, sheet: target }) : null;

        if (String(format).toLowerCase() === "json") {
          return res.json({
            metadata, type: "xlsx", sheet: target, sheets,
            total_rows, row_offset: start, row_limit: rl,
            has_more, next_cursor, encoding: "utf-8",
            content_text: JSON.stringify(sliceRows)
          });
        }

        const csv = sliceRows.map(r => r.map(v => {
          if (v == null) return "";
          const s = String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        }).join(",")).join("\n");

        return res.json({
          metadata, type: "xlsx", sheet: target, sheets,
          total_rows, row_offset: start, row_limit: rl,
          has_more, next_cursor, encoding: "utf-8", format: "csv",
          content_text: csv
        });
      } catch (err) {
        return res.json({
          metadata, type: "xlsx", needs_conversion: true,
          note: `XLSX parse failed. ${err?.message || ""}`.trim(),
          encoding: "base64", content_base64: slice.toString("base64")
        });
      }
    }

    // Inne formaty – sygnalizuj konwersję
    return res.json({
      metadata, type: e || "unknown", needs_conversion: true,
      note: "Unsupported format. Provide text/TXT/MD, DOCX, or PDF with text layer.",
      encoding: "base64", content_base64: slice.toString("base64")
    });

  } catch (e) {
    console.error("download_text_paginated error:", e);
    return res.status(500).json({ error: e?.message || String(e), stack: e?.stack || null });
  }
}
