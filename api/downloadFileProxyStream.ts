import { IncomingMessage, ServerResponse } from "http";
import https from "https";

/**
 * Pobiera plik z linku Dropboxa (temporary_link)
 * i streamuje go do klienta bez limitu rozmiaru.
 */
export default async function handler(
  req: IncomingMessage & { query?: any },
  res: ServerResponse
) {
  try {
    const { link } = req.query || {};
    if (!link) {
      res.statusCode = 400;
      res.end("Missing link parameter");
      return;
    }

    https.get(link, (stream) => {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/octet-stream");
      stream.pipe(res);
    }).on("error", (err) => {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err.message }));
    });
  } catch (error: any) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: error.message }));
  }
}
