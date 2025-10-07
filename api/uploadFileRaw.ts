import { Dropbox } from "dropbox";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Buffer } from "node:buffer";
import process from "node:process";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const { path, chunk_index = 0, total_chunks = 1, data, session_id } = req.body || {};
    if (!path || !data) {
      res.status(400).json({ error: "Missing parameters" });
      return;
    }

    const buffer = Buffer.from(data, "base64");
    const dbx = new Dropbox({
      clientId: process.env.DBX_CLIENT_ID,
      clientSecret: process.env.DBX_CLIENT_SECRET,
      refreshToken: process.env.DBX_REFRESH_TOKEN
    });

    if (total_chunks === 1) {
      // mały plik – klasyczny upload
      await dbx.filesUpload({
        path,
        contents: buffer,
        mode: { ".tag": "overwrite" }
      });
    } else {
      // upload w częściach
      if (chunk_index === 0) {
        const session = await dbx.filesUploadSessionStart({ contents: buffer });
        res.json({ session_id: session.result.session_id });
        return;
      } else if (chunk_index < total_chunks - 1) {
        await dbx.filesUploadSessionAppendV2({
          cursor: { session_id, offset: chunk_index * buffer.length },
          contents: buffer
        });
      } else {
        await dbx.filesUploadSessionFinish({
          cursor: { session_id, offset: chunk_index * buffer.length },
          commit: { path, mode: "overwrite" },
          contents: buffer
        });
      }
    }

    res.status(200).json({ ok: true, path });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "Upload failed" });
  }
}
