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

    const dbx = new Dropbox({ accessToken: process.env.DROPBOX_TOKEN });
    const file = await dbx.filesDownload({ path: decodeURIComponent(path as string) });

    const fileData: any = (file as any).result;
    const buffer = Buffer.from(
      fileData.fileBinary ?? (await fileData.fileBlob.arrayBuffer())
    );

    res.statusCode = 200;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(path as string)}.docx"`
    );
    res.write(buffer);
    res.end();
  } catch (error) {
    console.error(error);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.write(JSON.stringify({ error: "Download failed" }));
    res.end();
  }
}
