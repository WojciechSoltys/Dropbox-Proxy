import { Dropbox } from "dropbox";
import type { IncomingMessage, ServerResponse } from "http";
import { Buffer } from "node:buffer";
import process from "node:process";

export default async function handler(
  req: IncomingMessage & { query?: any },
  res: ServerResponse
) {
  try {
    const { path, chunk_size = "65536", chunk_index = "0" } = req.query || {};
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
    const base64 = buffer.toString("base64");

    const chunkSize = parseInt(chunk_size as string);
    const chunkIndex = parseInt(chunk_index as string);
    const start = chunkIndex * chunkSize;
    const end = Math.min(start + chunkSize, base64.length);
    const chunk = base64.slice(start, end);
    const totalChunks = Math.ceil(base64.length / chunkSize);

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        name: file.name,
        mime:
          file.result?.mime_type ||
          "application/octet-stream",
        size: buffer.length,
        chunk_index: chunkIndex,
        chunk_size: chunkSize,
        total_chunks: totalChunks,
        data: chunk
      })
    );
  } catch (error: any) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        error: "Chunked download failed",
        details: error?.message || "Unknown error"
      })
    );
  }
}
