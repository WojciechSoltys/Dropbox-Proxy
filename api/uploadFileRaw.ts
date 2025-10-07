import { Dropbox } from "dropbox";
import type { IncomingMessage, ServerResponse } from "http";
import { Buffer } from "node:buffer";
import process from "node:process";

export const config = {
  api: { bodyParser: false }
};

export default async function handler(
  req: IncomingMessage & { query?: any },
  res: ServerResponse
) {
  try {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Allow", "POST");
      res.end("Method Not Allowed");
      return;
    }

    const { path } = req.query || {};
    if (!path) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.write(JSON.stringify({ error: "Missing path parameter" }));
      res.end();
      return;
    }

    const basePath = "/Warsztat Opiniowy";
    if (!(path as string).startsWith(basePath)) {
      res.statusCode = 403;
      res.setHeader("Content-Type", "application/json");
      res.write(JSON.stringify({ error: "Access denied to this path" }));
      res.end();
      return;
    }

    const chunks: Uint8Array[] = [];
    for await (const chunk of req) chunks.push(chunk as Uint8Array);
    const buffer = Buffer.concat(chunks);

    const dbx = new Dropbox({
      clientId: process.env.DBX_CLIENT_ID,
      clientSecret: process.env.DBX_CLIENT_SECRET,
      refreshToken: process.env.DBX_REFRESH_TOKEN
    });

    await dbx.filesUpload({
      path: decodeURIComponent(path as string),
      contents: buffer,
      mode: { ".tag": "overwrite" }
    });

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.write(JSON.stringify({ ok: true, path }));
    res.end();
  } catch (error) {
    console.error("Upload failed:", error);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.write(
      JSON.stringify({
        error: "Upload failed",
        details:
          (error as any)?.error?.error_summary ||
          (error as any)?.message ||
          "Unknown error"
      })
    );
    res.end();
  }
}
