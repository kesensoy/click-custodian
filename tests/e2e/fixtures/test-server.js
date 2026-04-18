const { test: base } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');

/**
 * Test server fixture that serves e2e/*.html files
 */
const test = base.extend({
  testServer: async ({ }, use) => {
    const e2eDir = path.resolve(__dirname, '../../../e2e');
    const connections = new Set();

    const server = http.createServer((req, res) => {
      const filePath = path.join(e2eDir, req.url === '/' ? 'index.html' : req.url);

      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('File not found');
          return;
        }

        const ext = path.extname(filePath);
        const contentType = ext === '.html' ? 'text/html' : 'text/plain';

        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
      });
    });

    // Track connections to force-close them on teardown
    server.on('connection', (conn) => {
      connections.add(conn);
      conn.on('close', () => connections.delete(conn));
    });

    await new Promise((resolve) => {
      server.listen(0, 'localhost', resolve); // Random available port
    });

    const port = server.address().port;
    const baseURL = `http://localhost:${port}`;

    await use({ baseURL, port });

    // Force-close all connections before closing server
    connections.forEach(conn => conn.destroy());
    await new Promise((resolve) => {
      server.close(resolve);
    });
  },
});

module.exports = { test };
