import { Dropbox } from "dropbox";
import type { IncomingMessage, ServerResponse } from "http";
import { Buffer } from "node:buffer";
import process from "node:process";
import zlib from "node:zlib";
import https from "https";

/**
 * /api/downloadFileProxy
 * ----------------------
 * Jeden uniwersalny endpoint z trzema trybami:
 *
 *  ?mode=meta   → Zwraca metadane i tymczasowy link Dropboxa
 *  ?mode=stream → Strumieniuje plik z Dropboxa do klienta (bez limitu)
 *  ?mode=full   → Zwraca pełny plik (gzip+base64 lub base64)
 *
 * Przykłady:
 *  /api/downloadFileProxy?path=/Warsztat%20Opiniowy/...&mode=meta
 *  /api/downloadFileProxy?path=/Warsztat%20Opiniowy/...&mode=stream
 *  /api/downloadFileProxy?path=/Warsztat%20Opiniowy/...&mode=full&compressed=true
 */

export default async function handler(
  req: IncomingMessage & { query?: any },
  res: ServerResponse
) {
  try {
    const { path, mode = "full", compressed = "true", link } = req.query || {};

    // 🔹 Tryb 1: meta — tylko metadane i tymczasowy link Dropboxa
    if (mode === "meta") {
      if (!path) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Missing path parameter" }));
        return;
      }

      const dbx = new Dropbox({
        clientId: process.env.DBX_CLIENT_ID,
        clientSecret: process.env.DBX_CLIENT_SECRET,
        refreshToken: process.env.DBX_REFRESH_TOKEN
      });

      const meta = await dbx.filesGetMetadata({ path: decodeURIComponent(path as string) });
      const tmp = await dbx.filesGetTemporaryLink({ path: decodeURIComponent(path as string) });

      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          mode,
          name: (meta as any).result.name,
          size: (meta as any).result.size,
          mime:
            (meta as any).result.mime_type ||
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          temporary_link: tmp.result.link
        })
      );
      return;
    }

    // 🔹 Tryb 2: stream — serwerowe strumieniowanie pliku z Dropboxa
    if (mode === "stream") {
      // Jeżeli użytkownik poda link → użyj go, inaczej wygeneruj nowy
      let downloadLink = link;
      if (!downloadLink && path) {
        const dbx = new Dropbox({
          clientId: process.env.DBX_CLIENT_ID,
          clientSecret: process.env.DBX_CLIENT_SECRET,
          refreshToken: process.env.DBX_REFRESH_TOKEN
        });
        const tmp = await dbx.filesGetTemporaryLink({ path: decodeURIComponent(path as string) });
        downloadLink = tmp.result.link;
      }

      if (!downloadLink) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Missing link or path parameter" }));
        return;
      }

      // Streamuj plik z Dropboxa (bezpośrednio przez Twój serwer)
      https
        .get(downloadLink, (stream) => {
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/octet-stream");
          stream.pipe(res);
        })
        .on("error", (err) => {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err.message }));
        });

      return;
    }

    // 🔹 Tryb 3: full — zwraca cały plik gzip+base64 lub base64
    if (!path) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Missing path parameter" }));
      return;
    }

    const dbx = new Dropbox({
      clientId: process.env.DBX_CLIENT_ID,
      clientSecret: process.env.DBX_CLIENT_SECRET,
      refreshToken: process.env.DBX_REFRESH_TOKEN
    });

    const response = await dbx.filesDownload({
      path: decodeURIComponent(path as string)
    });
    const file = (response as any).result;
    const ab =
      file.fileBinary ??
      (file.fileBlob ? await file.fileBlob.arrayBuffer() : undefined);

    if (!ab) throw new Error("No binary content from Dropbox");

    const buffer = Buffer.from(ab);
    const mime =
      file.result?.mime_type ||
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

    // Tryb base64 (bez kompresji)
    if (compressed === "false") {
      const base64 = buffer.toString("base64");
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          mode,
          name: file.name,
          size: buffer.length,
          mime,
          encoding: "base64",
          base64
        })
      );
      return;
    }

    // Tryb gzip+base64 (kompresowany)
    const gzipped = zlib.gzipSync(buffer);
    const base64 = gzipped.toString("base64");

    // Jeśli za duży — zwróć link zamiast danych
    if (base64.length > 4.5 * 1024 * 1024) {
      const tmp = await dbx.filesGetTemporaryLink({
        path: decodeURIComponent(path as string)
      });
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          note: "file too large, returning link instead",
          mode: "meta",
          name: file.name,
          size: buffer.length,
          mime,
          temporary_link: tmp.result.link
        })
      );
      return;
    }

    // Standardowa odpowiedź gzip+base64
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        mode,
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
        details: error?.message || "Unknown error"
      })
    );
  }
}
