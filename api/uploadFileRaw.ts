import { Dropbox } from "dropbox";
import type { IncomingMessage, ServerResponse } from "http";
import { Buffer } from "node:buffer";
import process from "node:process";

export const config = {
  api: { bodyParser: false },
};

export default async function handler(req: IncomingMessage & { query?: any; body?: any }, res: ServerResponse & { status?: any; json?: any }) {
  try {
    const { path } = req.query;
    if (!path) return res.status(400).json({ error: "Missing path parameter" });

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
      mode: { ".tag": "overwrite" },
    });

    res.status(200).json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Upload failed" });
  }
}
