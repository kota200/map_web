import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argumentsList = process.argv.slice(2);

function argumentValue(name, fallback) {
  const index = argumentsList.indexOf(name);
  return index >= 0 && argumentsList[index + 1] ? argumentsList[index + 1] : fallback;
}

const bind = argumentValue('--bind', '127.0.0.1');
const port = Number.parseInt(argumentValue('--port', '8000'), 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid port: ${port}`);

const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.fa', 'text/plain; charset=utf-8'],
  ['.fastq', 'text/plain; charset=utf-8'],
  ['.fq', 'text/plain; charset=utf-8'],
  ['.gtf', 'text/plain; charset=utf-8'],
  ['.gz', 'application/gzip'],
  ['.ht2', 'application/octet-stream'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.tsv', 'text/tab-separated-values; charset=utf-8'],
  ['.wasm', 'application/wasm'],
]);

function sendHeaders(response) {
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('Cache-Control', 'no-store');
}

const server = createServer(async (request, response) => {
  sendHeaders(response);
  if (!['GET', 'HEAD'].includes(request.method || 'GET')) {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end('Method not allowed.');
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url || '/', `http://${bind}:${port}`).pathname);
  } catch {
    response.writeHead(400);
    response.end('Invalid URL.');
    return;
  }

  const relativePath = pathname.replace(/^\/+/, '');
  let target = resolve(appRoot, relativePath || 'index.html');
  if (target !== appRoot && !target.startsWith(`${appRoot}${sep}`)) {
    response.writeHead(403);
    response.end('Forbidden.');
    return;
  }

  try {
    let details = await stat(target);
    if (details.isDirectory()) {
      target = join(target, 'index.html');
      details = await stat(target);
    }
    if (!details.isFile()) throw new Error('Not a file.');
    response.writeHead(200, {
      'Content-Length': details.size,
      'Content-Type': mimeTypes.get(extname(target).toLowerCase()) || 'application/octet-stream',
    });
    if (request.method === 'HEAD') response.end();
    else createReadStream(target).pipe(response);
  } catch {
    response.writeHead(404);
    response.end('Not found.');
  }
});

server.listen(port, bind, () => {
  console.log(`Serving kallisto Web at http://${bind}:${port}/ from ${appRoot}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
