import { Dropbox } from "dropbox";
import type { IncomingMessage, ServerResponse } from "http";
import { Buffer } from "node:buffer";
import process from "node:process";
import zlib from "node:zlib";

/**
 * Jeśli wynik po kompresji przekracza 5 MB, endpoint automatycznie
 * zapisuje gzip-base64 do pliku tymczasowego w Dropboxie i zwraca link.
 */
export default async function handler(
  req: IncomingMessage & { query?: any },
  res: ServerResponse
) {
  try {
    const { path, compressed = "true" } = req.query || {};
    if (!path) {
      res.statusCode = 400;
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
    if (!ab) throw new Error("No binary content");

    const buffer = Buffer.from(ab);
    const mime =
      file.result?.mime_type ||
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

    // ─────────────────────────────────────────────
    // 🔹 Kompresja gzip + base64
    const gzipped = zlib.gzipSync(buffer);
    const base64 = gzipped.toString("base64");

    // Jeśli wynik przekracza 5 MB → generujemy tymczasowy plik i link
    const limit = 5 * 1024 * 1024;
    if (base64.length > limit * 1.33) {
      const tmpPath = `/Warsztat Opiniowy/_temp/${file.name}.gz.b64.json`;
      await dbx.filesUpload({
        path: tmpPath,
        contents: Buffer.from(
          JSON.stringify({
            name: file.name,
            size: buffer.length,
            compressed: gzipped.length,
            mime,
            encoding: "gzip+base64",
            base64
          })
        ),
        mode: { ".tag": "overwrite" }
      });
      const tmp = await dbx.filesGetTemporaryLink({ path: tmpPath });
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          note: "payload too large, returned link instead",
          name: file.name,
          size: buffer.length,
          mime,
          temporary_link: tmp.result.link
        })
      );
      return;
    }

    // ─────────────────────────────────────────────
    // 🔹 Standardowa odpowiedź gzip+base64
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
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        error: error?.message || "Download failed"
      })
    );
  }
}
