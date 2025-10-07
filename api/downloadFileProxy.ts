import { Dropbox } from "dropbox";
import type { IncomingMessage, ServerResponse } from "http";
import { Buffer } from "node:buffer";
import process from "node:process";
import zlib from "node:zlib";

/**
 * Endpoint: /api/downloadFileProxy
 * --------------------------------
 * Zwraca pełny plik z Dropboxa w jednym JSON, opcjonalnie skompresowany gzip+base64.
 * 
 * Parametry:
 * - path (string, wymagany): pełna ścieżka do pliku w Dropboxie (musi zaczynać się od /Warsztat Opiniowy)
 * - compressed (boolean, opcjonalny): jeśli true (domyślnie), plik zostanie skompresowany gzip i zakodowany base64.
 *
 * Przykład:
 *   /api/downloadFileProxy?path=/Warsztat%20Opiniowy/Wytyczne/Papiery/OL-9%20-%20CZP.docx&compressed=true
 */

export default async function handler(
  req: IncomingMessage & { query?: any },
  res: ServerResponse
) {
  try {
    const { path, compressed = "true" } = req.query || {};

    // 🔹 Walidacja parametru path
    if (!path) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Missing path parameter" }));
      return;
    }

    const basePath = "/Warsztat Opiniowy";
    if (!(path as string).startsWith(basePath)) {
      res.statusCode = 403;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Access denied to this path" }));
      return;
    }

    // 🔹 Połączenie z Dropbox API
    const dbx = new Dropbox({
      clientId: process.env.DBX_CLIENT_ID,
      clientSecret: process.env.DBX_CLIENT_SECRET,
      refreshToken: process.env.DBX_REFRESH_TOKEN
    });

    // 🔹 Pobierz plik z Dropboxa
    const response = await dbx.filesDownload({
      path: decodeURIComponent(path as string)
    });
    const file = (response as any).result;

    const arrayBuffer =
      file.fileBinary ??
      (file.fileBlob ? await file.fileBlob.arrayBuffer() : undefined);

    if (!arrayBuffer) {
      throw new Error("No binary content in Dropbox response");
    }

    const buffer = Buffer.from(arrayBuffer);
    const mime =
      file.result?.mime_type ||
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

    // 🔹 Obsługa trybu compressed=false
    if (compressed === "false") {
      const base64 = buffer.toString("base64");
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          name: file.name,
          size: buffer.length,
          mime,
          encoding: "base64",
          base64
        })
      );
      return;
    }

    // 🔹 Domyślnie: kompresja gzip + base64
    const gzipped = zlib.gzipSync(buffer);
    const base64 = gzipped.toString("base64");

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        name: file.name,
        size: buffer.length,
        compressed: gzipped.length,
        mime,
        encoding: "gzip+base64",
        base64
      })
    );
  } catch (error: any) {
    console.error("Download failed:", error);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        error: "Download failed",
        details:
          error?.error?.error_summary ||
          error?.message ||
          "Unknown error"
      })
    );
  }
}
