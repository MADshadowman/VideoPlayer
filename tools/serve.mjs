import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";

const root = process.cwd();
const port = Number(process.argv[2] || 8080);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".ogv": "video/ogg",
  ".ogg": "audio/ogg",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".mp3": "audio/mpeg",
  ".woff2": "font/woff2",
};

const server = createServer(async (req, res) => {
  try {
    await handle(req, res);
  } catch (error) {
    res.writeHead(500).end(String(error?.message || error));
  }
});

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(url.pathname);

  const filePath = path.normalize(path.join(root, pathname));
  if (!filePath.startsWith(root)) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    res.writeHead(404).end("Not found");
    return;
  }

  if (stat.isDirectory()) {
    const indexFile = path.join(filePath, "index.html");
    try {
      const indexStat = await fs.stat(indexFile);
      return await sendFile(res, indexFile, indexStat, req.headers.range);
    } catch {
      const entries = await fs.readdir(filePath, { withFileTypes: true });
      const links = entries
        .filter((entry) => !entry.name.startsWith("."))
        .map((entry) => {
          const name = entry.isDirectory() ? `${entry.name}/` : entry.name;
          return `<li><a href="${pathname.endsWith("/") ? pathname : `${pathname}/`}${name}">${name}</a></li>`;
        })
        .join("");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(
        `<!doctype html><meta charset="utf-8"><title>Index of ${pathname}</title><h1>Index of ${pathname}</h1><ul>${links}</ul>`
      );
      return;
    }
  }

  return sendFile(res, filePath, stat, req.headers.range);
}

async function sendFile(res, filePath, stat, rangeHeader) {
  const mime = MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";

  if (rangeHeader) {
    const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
    const start = match ? Number(match[1] || 0) : 0;
    const end = match && match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;

    if (Number.isNaN(start) || start >= stat.size || start > end) {
      res.writeHead(416, { "Content-Range": `bytes */${stat.size}` }).end();
      return;
    }

    res.writeHead(206, {
      "Content-Type": mime,
      "Content-Length": end - start + 1,
      "Content-Range": `bytes ${start}-${end}/${stat.size}`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-cache",
    });
    const stream = (await import("node:fs")).createReadStream(filePath, { start, end });
    stream.pipe(res);
    stream.on("error", () => res.destroy());
    return;
  }

  res.writeHead(200, {
    "Content-Type": mime,
    "Content-Length": stat.size,
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-cache",
  });
  const stream = (await import("node:fs")).createReadStream(filePath);
  stream.pipe(res);
  stream.on("error", () => res.destroy());
}

server.listen(port, () => {
  console.log(`VideoPlayer dev server running at http://localhost:${port}`);
});
