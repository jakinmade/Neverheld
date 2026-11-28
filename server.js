// Minimal static server for the NEVERHELD demo. No dependencies.
const http = require("http");
const fs = require("fs");
const path = require("path");
const root = __dirname;
const types = { ".html": "text/html; charset=utf-8", ".json": "application/json", ".js": "text/javascript; charset=utf-8", ".gz": "application/gzip", ".zip": "application/zip", ".sha256": "text/plain; charset=utf-8" };
http.createServer((req, res) => {
  let url = decodeURIComponent((req.url || "/").split("?")[0]);
  if (url === "/") url = "/index.html";
  const file = path.normalize(path.join(root, url));
  if (!file.startsWith(root + path.sep) || /server\.js$|package\.json$/.test(file) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { "content-type": "text/plain" }); res.end("Not found"); return;
  }
  res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "access-control-allow-origin": "*" });
  fs.createReadStream(file).pipe(res);
}).listen(process.env.PORT || 3000, "0.0.0.0", () => console.log("NEVERHELD demo listening"));
