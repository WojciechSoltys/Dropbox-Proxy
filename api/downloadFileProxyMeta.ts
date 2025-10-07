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
      res.end(JSON.stringify({ error: "Missing path" }));
      return;
    }

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
        name: (meta as any).result.name,
        size: (meta as any).result.size,
        mime:
          (meta as any).result.mime_type ||
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        temporary_link: tmp.result.link
      })
    );
  } catch (error: any) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: error?.message || "Metadata download failed" }));
  }
}
