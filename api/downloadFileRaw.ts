import { Dropbox } from "dropbox";
import type { IncomingMessage, ServerResponse } from "http";
import { Buffer } from "node:buffer";
import process from "node:process";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { path } = req.query;
    if (!path) return res.status(400).json({ error: "Missing path parameter" });

    const dbx = new Dropbox({ accessToken: process.env.DROPBOX_TOKEN });
    const file = await dbx.filesDownload({ path: decodeURIComponent(path as string) });

    const fileData: any = (file as any).result;
    const buffer = Buffer.from(
      fileData.fileBinary ?? (await fileData.fileBlob.arrayBuffer())
    );

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(path as string)}.docx"`
    );
    res.send(buffer);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Download failed" });
  }
}
