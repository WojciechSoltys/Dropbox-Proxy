import { Dropbox } from "dropbox";
import type { IncomingMessage, ServerResponse } from "http";
import { Buffer } from "node:buffer";
import process from "node:process";
import zlib from "node:zlib";
import https from "https";

/**
 * /api/downloadFileProxy
 * ------------------------------------------------
 * Tryby:
 *  - mode=meta        → metadane + link Dropboxa
 *  - mode=stream      → strumieniowanie pliku (bez limitu)
 *  - mode=full        → pełny plik (gzip+base64 lub base64)
 *  - mode=relay       → zwraca link proxy (dla sandboxów)
 *  - mode=jsonBase64  → zwraca cały plik jako JSON (base64) – używane przez sandbox
 */

export default async function handler(
  req: IncomingMessage & { query?: any },
  res: ServerResponse
) {
  try {
    const { path, mode = "full", compressed = "true", link } = req.query || {};

    // Uniwersalne nagłówki
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (!path && mode !== "stream" && mode !== "relay") {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Missing path parameter" }));
      return;
    }

    // 🔹 Tryb META
    if (mode === "meta") {
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

    // 🔹 Tryb STREAM
    if (mode === "stream") {
      let streamLink = link;
      if (!streamLink && path) {
        const dbx = new Dropbox({
          clientId: process.env.DBX_CLIENT_ID,
          clientSecret: process.env.DBX_CLIENT_SECRET,
          refreshToken: process.env.DBX_REFRESH_TOKEN
        });
        const tmp = await dbx.filesGetTemporaryLink({ path: decodeURIComponent(path as string) });
        streamLink = tmp.result.link;
      }

      if (!streamLink) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Missing link or path parameter for stream" }));
        return;
      }

      https
        .get(streamLink, (stream) => {
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/octet-stream");
          res.setHeader("Cache-Control", "no-store");
          stream.pipe(res);
        })
        .on("error", (err) => {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err.message }));
        });
      return;
    }

    // 🔹 Tryb RELAY
    if (mode === "relay") {
      const dbx = new Dropbox({
        clientId: process.env.DBX_CLIENT_ID,
        clientSecret: process.env.DBX_CLIENT_SECRET,
        refreshToken: process.env.DBX_REFRESH_TOKEN
      });

      const tmp = await dbx.filesGetTemporaryLink({ path: decodeURIComponent(path as string) });

      const relayUrl = `${process.env.API_BASE_URL || "https://dropbox-proxy-three.vercel.app/api"}/downloadFileProxy?mode=stream&link=${encodeURIComponent(tmp.result.link)}`;

      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          mode: "relay",
          note: "relay link generated — use this link to stream file without sandbox limit",
          name: tmp.result.metadata.name,
          size: tmp.result.metadata.size,
          mime:
            (tmp.result.metadata as any).mime_type ||
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          relay_link: relayUrl
        })
      );
      return;
    }

    // 🔹 Tryb JSON_BASE64
    if (mode === "jsonBase64") {
      const dbx = new Dropbox({
        clientId: process.env.DBX_CLIENT_ID,
        clientSecret: process.env.DBX_CLIENT_SECRET,
        refreshToken: process.env.DBX_REFRESH_TOKEN
      });

      const response = await dbx.filesDownload({ path: decodeURIComponent(path as string) });
      const file = (response as any).result;
      const ab =
        file.fileBinary ??
        (file.fileBlob ? await file.fileBlob.arrayBuffer() : undefined);
      const buffer = Buffer.from(ab);

      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.end(
        JSON.stringify({
          mode,
          name: file.name,
          size: buffer.length,
          mime:
            (file.result as any)?.mime_type ||
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          base64: buffer.toString("base64")
        })
      );
      return;
    }

    // 🔹 Tryb FULL
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

    if (!ab) throw new Error("No binary content in Dropbox response");

    const buffer = Buffer.from(ab);
    const mime =
      (file.result as any)?.mime_type ||
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

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

    const gzipped = zlib.gzipSync(buffer);
    const base64 = gzipped.toString("base64");

    if (base64.length > 4.5 * 1024 * 1024) {
      const tmp = await dbx.filesGetTemporaryLink({
        path: decodeURIComponent(path as string)
      });
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          note: "File too large for inline base64, returning relay link instead.",
          mode: "relay",
          relay_link: `${process.env.API_BASE_URL || "https://dropbox-proxy-three.vercel.app/api"}/downloadFileProxy?mode=stream&link=${encodeURIComponent(tmp.result.link)}`,
          name: file.name,
          size: buffer.length,
          mime
        })
      );
      return;
    }

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
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        error: "Download failed",
        details: error?.message || "Unknown error"
      })
    );
  }
}
