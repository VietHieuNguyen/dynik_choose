// Simple static server for dynik-site on a fixed port.
// Serves files from this directory.
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 4173;
const ROOT = __dirname;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
  let rawUrl = req.url.split("?")[0];
  let url;
  try {
    url = decodeURIComponent(rawUrl);
  } catch (_) {
    url = rawUrl;
  }
  if (url === "/") url = "/index.html";
  const filePath = path.join(ROOT, url);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); return res.end("forbidden");
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      return res.end("not found: " + url);
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "content-type": MIME[ext] || "application/octet-stream",
      "cache-control": "no-store",
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.log(`Cổng ${PORT} đang được sử dụng. Đang thử mở cổng ${PORT + 1}...`);
    server.listen(PORT + 1, "127.0.0.1", () => {
      console.log(`DYNIK site running at http://127.0.0.1:${PORT + 1}/`);
    });
  } else {
    console.error("Lỗi server:", err);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`DYNIK site running at http://127.0.0.1:${PORT}/`);
});
