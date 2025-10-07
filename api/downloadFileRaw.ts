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
    const { path } = req.query || {};
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
    const base64 = buffer.toString("base64");
    const mime =
      file.result?.mime_type ||
      "application/octet-stream";
    const acceptsGzip = (req.headers["accept-encoding"] || "").includes("gzip");
    const wantsBinary = req.headers["accept"]?.includes("application/octet-stream");

    if (wantsBinary) {
      res.statusCode = 200;
      res.setHeader("Content-Type", mime);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${encodeURIComponent(file.name)}"`
      );
      res.end(buffer);
      return;
    }

    const json = JSON.stringify({
      name: file.name,
      mime,
      size: buffer.length,
      base64
    });

    if (acceptsGzip) {
      const gz = zlib.gzipSync(json);
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Encoding", "gzip");
      res.end(gz);
      return;
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(json);
  } catch (error: any) {
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
