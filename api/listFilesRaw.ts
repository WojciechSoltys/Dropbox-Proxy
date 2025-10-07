import { Dropbox } from "dropbox";
import type { IncomingMessage, ServerResponse } from "http";
import process from "node:process";

export default async function handler(
  req: IncomingMessage & { query?: any },
  res: ServerResponse
) {
  try {
    const dbx = new Dropbox({
      clientId: process.env.DBX_CLIENT_ID,
      clientSecret: process.env.DBX_CLIENT_SECRET,
      refreshToken: process.env.DBX_REFRESH_TOKEN
    });

    const userPath = req.query?.path
      ? decodeURIComponent(req.query.path as string)
      : "";
    const basePath = "/Warsztat Opiniowy";
    const fullPath = userPath.startsWith(basePath)
      ? userPath
      : basePath;

    const files = await dbx.filesListFolder({ path: fullPath });
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.write(JSON.stringify({ entries: files.result.entries }));
    res.end();
  } catch (error) {
    console.error("List failed:", error);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.write(
      JSON.stringify({
        error: "List failed",
        details:
          (error as any)?.error?.error_summary ||
          (error as any)?.message ||
          "Unknown error"
      })
    );
    res.end();
  }
}
