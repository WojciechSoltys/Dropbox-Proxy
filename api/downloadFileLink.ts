import { Dropbox } from "dropbox";
import type { IncomingMessage, ServerResponse } from "http";
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

    const dbx = new Dropbox({
      clientId: process.env.DBX_CLIENT_ID,
      clientSecret: process.env.DBX_CLIENT_SECRET,
      refreshToken: process.env.DBX_REFRESH_TOKEN
    });

    const tmp = await dbx.filesGetTemporaryLink({
      path: decodeURIComponent(path as string)
    });

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        name: tmp.result.metadata.name,
        size: tmp.result.metadata.size,
        mime:
          tmp.result.metadata.mime_type ||
          "application/octet-stream",
        temporary_link: tmp.result.link
      })
    );
  } catch (error: any) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        error: "Temporary link failed",
        details: error?.message || "Unknown error"
      })
    );
  }
}
