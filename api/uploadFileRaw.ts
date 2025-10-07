import { Dropbox } from "dropbox";
import type { IncomingMessage, ServerResponse } from "http";
import { Buffer } from "node:buffer";
import process from "node:process";

export default async function handler(
  req: IncomingMessage & { body?: any },
  res: ServerResponse
) {
  try {
    const { path, chunk_index = 0, total_chunks = 1, data, session_id } = req.body || {};
    if (!path || !data) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "Missing parameters" }));
      return;
    }

    const buffer = Buffer.from(data, "base64");
    const dbx = new Dropbox({
      clientId: process.env.DBX_CLIENT_ID,
      clientSecret: process.env.DBX_CLIENT_SECRET,
      refreshToken: process.env.DBX_REFRESH_TOKEN
    });

    if (total_chunks === 1) {
      await dbx.filesUpload({
        path,
        contents: buffer,
        mode: { ".tag": "overwrite" }
      });
    } else {
      if (chunk_index === 0) {
        const session = await dbx.filesUploadSessionStart({ contents: buffer });
        res.statusCode = 200;
        res.end(JSON.stringify({ session_id: session.result.session_id }));
        return;
      } else if (chunk_index < total_chunks - 1) {
        await dbx.filesUploadSessionAppendV2({
          cursor: { session_id, offset: chunk_index * buffer.length },
          contents: buffer
        });
      } else {
        await dbx.filesUploadSessionFinish({
          cursor: { session_id, offset: chunk_index * buffer.length },
          commit: { path, mode: { ".tag": "overwrite" } },
          contents: buffer
        });
      }
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true, path }));
  } catch (error: any) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: error?.message || "Upload failed" }));
  }
}
