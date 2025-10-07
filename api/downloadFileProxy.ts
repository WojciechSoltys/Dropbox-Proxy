import { Dropbox } from "dropbox";
import type { IncomingMessage, ServerResponse } from "http";
import { Buffer } from "node:buffer";
import process from "node:process";
import zlib from "node:zlib";

export default async function handler(
  req: IncomingMessage & { query?: any },
  res: ServerResponse
) {
  try {
    const { path, compressed = "true" } = req.query || {};
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

    // 🔹 Najpierw pobierz metadane (rozmiar)
    const meta = await dbx.filesGetMetadata({ path: decodeURIComponent(path as string) });
    const size = (meta as any).result.size || 0;
    const name = (meta as any).result.name;

    // 🔹 Jeśli plik > 4.5 MB → od razu zwróć tymczasowy link (bez pobierania binariów)
    if (size > 4.5 * 1024 * 1024) {
      const tmp = await dbx.filesGetTemporaryLink({
        path: decodeURIComponent(path as string)
      });
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          note: "file too large for inline base64, returned temporary link instead",
          name,
          size,
          mime:
            (meta as any).result.mime_type ||
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          temporary_link: tmp.result.link
        })
      );
      return;
    }

    // 🔹 Dla mniejszych plików: pobierz, skompresuj i zwróć base64
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
        error: error?.message || "Download failed"
      })
    );
  }
}
