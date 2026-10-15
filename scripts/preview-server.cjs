const http = require('node:http'),
  fs = require('node:fs'),
  path = require('node:path');
const root = path.resolve(__dirname, '..');
const files = {
  '/preview.html': 'text/html',
  '/preview-stories.js': 'text/javascript',
  '/preview.js': 'text/javascript',
  '/preview-experience.js': 'text/javascript',
  '/preview-design.css': 'text/css',
};
http
  .createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const key = pathname === '/' ? '/preview.html' : pathname;
    if (!Object.hasOwn(files, key)) {
      res.writeHead(404);
      return res.end();
    }
    fs.readFile(path.join(root, key.slice(1)), (error, data) => {
      if (error) {
        res.writeHead(500);
        return res.end();
      }
      res.writeHead(200, { 'Content-Type': files[key], 'Cache-Control': 'no-store' });
      res.end(data);
    });
  })
  .listen(Number(process.env.PORT || 4174), '127.0.0.1');
