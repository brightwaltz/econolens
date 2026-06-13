// ローカル開発サーバー(Vercel なしで動作確認するため)。
// public/ を静的配信し、/api/<name> を api/<name>.js と同じロジックで提供する。
//
//   node dev-server.mjs        -> http://localhost:3000
//
// 本番(Vercel)では public/ が静的配信、api/*.js がサーバーレス関数になるため、
// このファイルはデプロイ対象外(.vercelignore で除外)。

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, "public");
const PORT = process.env.PORT || 3000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

// リクエストボディ(JSON)を読む。
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // /api/<name> を api/<name>.js のハンドラへルーティング。
  if (url.pathname.startsWith("/api/")) {
    const name = basename(url.pathname.slice("/api/".length));
    let handler;
    try {
      ({ default: handler } = await import(`./api/${name}.js`));
    } catch {
      res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: `unknown api: ${name}` }));
      return;
    }

    const body = req.method === "POST" ? await readBody(req) : {};
    const fauxReq = {
      method: req.method,
      headers: req.headers,
      query: Object.fromEntries(url.searchParams),
      body,
    };
    const fauxRes = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) {
        this.headers[k] = v;
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(obj) {
        res.writeHead(this.statusCode, {
          "Content-Type": "application/json; charset=utf-8",
          ...this.headers,
        });
        res.end(JSON.stringify(obj));
      },
    };
    await handler(fauxReq, fauxRes);
    return;
  }

  // 静的ファイル。
  let path = decodeURIComponent(url.pathname);
  if (path === "/") path = "/index.html";
  const filePath = normalize(join(PUBLIC, path));
  if (!filePath.startsWith(PUBLIC)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const buf = await readFile(filePath);
    res.writeHead(200, { "Content-Type": MIME[extname(filePath)] || "application/octet-stream" });
    res.end(buf);
  } catch {
    res.writeHead(404).end("Not found");
  }
});

server.listen(PORT, () => {
  console.log(`EconoLens dev server: http://localhost:${PORT}`);
});
