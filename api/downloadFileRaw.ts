import { Dropbox } from 'dropbox';
import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { path } = req.query;
    if (!path) return res.status(400).json({ error: 'Missing path parameter' });

    const dbx = new Dropbox({ accessToken: process.env.DROPBOX_TOKEN });
    const file = await dbx.filesDownload({ path: decodeURIComponent(path as string) });

    const buffer = Buffer.from((file.result as any).fileBinary as ArrayBuffer);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${path}.docx"`);
    res.send(buffer);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Download failed' });
  }
}
