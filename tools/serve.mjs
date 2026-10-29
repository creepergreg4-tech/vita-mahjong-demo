import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chosen = process.argv[2] || (fs.existsSync(path.join(project,'dist-v2/index.html')) ? 'dist-v2' : 'dist');
const root = path.resolve(project, chosen);
const port = Number(process.env.PORT || 4178);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".wav": "audio/wav",
  ".webp": "image/webp",
};
if (!fs.existsSync(path.join(root, "index.html"))) {
  console.error(
    "找不到 dist/index.html，请先运行 npm install 和 npm run build。",
  );
  process.exit(1);
}
const server = http.createServer((req, res) => {
  try {
    let pathname = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    if (pathname === "/") pathname = "/index.html";
    const file = path.resolve(root, "." + pathname);
    if (
      !file.startsWith(root + path.sep) ||
      !fs.existsSync(file) ||
      !fs.statSync(file).isFile()
    ) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.setHeader(
      "Content-Type",
      types[path.extname(file)] || "application/octet-stream",
    );
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Content-Type-Options", "nosniff");
    fs.createReadStream(file).pipe(res);
  } catch {
    res.writeHead(400);
    res.end("Bad request");
  }
});
server.on("error", (e) => {
  console.error(
    e.code === "EADDRINUSE"
      ? `端口 ${port} 已被占用；可能已有体验服务运行。`
      : e.message,
  );
  process.exit(1);
});
server.listen(port, "0.0.0.0", () => {
  console.log(
    `Vita Mahjong · 巧解\n电脑访问：http://localhost:${port}/\n手机需连接同一 Wi-Fi：`,
  );
  for (const list of Object.values(os.networkInterfaces()))
    for (const n of list || [])
      if (n.family === "IPv4" && !n.internal)
        console.log(`  http://${n.address}:${port}/`);
  console.log("保持此窗口开启。按 Ctrl+C 结束。");
});
