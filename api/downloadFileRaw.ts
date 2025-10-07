import { Dropbox } from "dropbox";
import type { IncomingMessage, ServerResponse } from "http";
import { Buffer } from "node:buffer";
import process from "node:process";

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

    // Pobranie pliku
    const response = await dbx.filesDownload({
      path: decodeURIComponent(path as string)
    });
    const file = (response as any).result;
    const name = file.name;
    const mime = file.result?.mime_type || "application/octet-stream";

    // Obsługa danych binarnych (NodeBuffer lub Blob)
    let arrayBuffer: ArrayBuffer;
    if (file.fileBinary) {
      arrayBuffer = file.fileBinary;
    } else if (file.fileBlob) {
      arrayBuffer = await file.fileBlob.arrayBuffer();
    } else if (file.fileBinary instanceof ArrayBuffer) {
      arrayBuffer = file.fileBinary;
    } else {
      throw new Error("No valid binary content returned from Dropbox");
    }

    const buffer = Buffer.from(arrayBuffer);
    const base64 = buffer.toString("base64");

    // Zwrócenie JSON zamiast binariów
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        name,
        mime,
        size: buffer.length,
        base64
      })
    );
  } catch (error) {
    console.error("Download failed:", error);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        error: "Download failed",
        details:
          (error as any)?.error?.error_summary ||
          (error as any)?.message ||
          "Unknown error"
      })
    );
  }
}
