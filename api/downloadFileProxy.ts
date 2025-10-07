import { Dropbox } from "dropbox";
import type { IncomingMessage, ServerResponse } from "http";
import process from "node:process";
import { Buffer } from "node:buffer";
import zlib from "node:zlib";

export default async function handler(
  req: IncomingMessage & { query?: any },
  res: ServerResponse
) {
  try {
    const { path } = req.query || {};
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

    // 🔹 Pobierz plik z Dropboxa
    const response = await dbx.filesDownload({ path: decodeURIComponent(path as string) });
    const file = (response as any).result;
    const ab = file.fileBinary ?? (file.fileBlob ? await file.fileBlob.arrayBuffer() : undefined);
    if (!ab) throw new Error("No binary content in Dropbox response");

    const buffer = Buffer.from(ab);

    // 🔹 Kompresja i kodowanie base64
    const gzipped = zlib.gzipSync(buffer);
    const base64 = gzipped.toString("base64");

    // 🔹 Zwróć metadane i zawartość
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        name: file.name,
        size: buffer.length,
        compressed: gzipped.length,
        mime:
          file.result?.mime_type ||
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        encoding: "gzip+base64",
        base64
      })
    );
  } catch (error: any) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: error.message || "Download failed" }));
  }
}
