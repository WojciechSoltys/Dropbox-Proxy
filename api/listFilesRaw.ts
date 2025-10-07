import { Dropbox } from "dropbox";
import type { IncomingMessage, ServerResponse } from "http";
import process from "node:process";

export default async function handler(req: IncomingMessage & { query?: any; body?: any }, res: ServerResponse & { status?: any; json?: any }) {
  try {
    const { path } = req.query;
  const dbx = new Dropbox({
  clientId: process.env.DBX_CLIENT_ID,
  clientSecret: process.env.DBX_CLIENT_SECRET,
  refreshToken: process.env.DBX_REFRESH_TOKEN
});
    const files = await dbx.filesListFolder({
      path: path ? decodeURIComponent(path as string) : "",
    });
    res.status(200).json({ entries: files.result.entries });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "List failed" });
  }
}
