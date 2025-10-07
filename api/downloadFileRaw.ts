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

    const dbx = new Dropbox({
      clientId: process.env.DBX_CLIENT_ID,
      clientSecret: process.env.DBX_CLIENT_SECRET,
      refreshToken: process.env.DBX_REFRESH_TOKEN
    });

    const file = await dbx.filesDownload({ path: decodeURIComponent(path as string) });
    const fileData: any = (file as any).result;
    const buffer = Buffer.from(
      fileData.fileBinary ?? (await fileData.fileBlob.arrayBuffer())
    );

    res.statusCode = 200;
    res.setHeader(
      "Content-Type",
      "application/octet-stream"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(fileData.name)}"`
    );
    res.write(buffer);
    res.end();
  } catch (error) {
    console.error("Download failed:", error);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.write(
      JSON.stringify({
        error: "Download failed",
        details:
          (error as any)?.error?.error_summary ||
          (error as any)?.message ||
          "Unknown error"
      })
    );
    res.end();
  }
}

