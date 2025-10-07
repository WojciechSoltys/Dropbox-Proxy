import { Dropbox } from "dropbox";
import type { NextApiRequest, NextApiResponse } from "next";
import { Buffer } from "node:buffer";
import process from "node:process";

export const config = {
  api: { bodyParser: false },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { path } = req.query;
    if (!path) return res.status(400).json({ error: "Missing path parameter" });

    const chunks: Uint8Array[] = [];
    for await (const chunk of req) chunks.push(chunk as Uint8Array);
    const buffer = Buffer.concat(chunks);

    const dbx = new Dropbox({ accessToken: process.env.DROPBOX_TOKEN });
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
