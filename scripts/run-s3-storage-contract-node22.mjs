import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { resolve } from 'node:path';

const expectedNodeVersion = process.env.E2E_NODE_VERSION || '22.23.2';
if (process.versions.node !== expectedNodeVersion) {
  console.error(`S3 contract requires Node ${expectedNodeVersion}; detected ${process.versions.node}.`);
  process.exit(2);
}

const bucket = 'splint-r2-contract';
const objects = new Map();

function objectKey(pathname) {
  const prefix = `/${bucket}/`;
  if (!pathname.startsWith(prefix)) return null;
  return decodeURIComponent(pathname.slice(prefix.length));
}

function send(response, status, headers = {}, body = '') {
  response.writeHead(status, headers);
  response.end(body);
}

const server = createServer(async (request, response) => {
  if (request.method === 'HEAD' && request.url?.split('?')[0] === `/${bucket}`) {
    send(response, 200);
    return;
  }

  const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
  const key = objectKey(pathname);
  if (key === null) {
    send(response, 404);
    return;
  }

  if (request.method === 'PUT') {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    objects.set(key, {
      body: Buffer.concat(chunks),
      contentType: request.headers['content-type'] || 'application/octet-stream',
    });
    send(response, 200);
    return;
  }

  if (request.method === 'HEAD' || request.method === 'GET') {
    const object = objects.get(key);
    if (!object) {
      send(response, 404, { 'Content-Type': 'application/xml' }, '<Error><Code>NoSuchKey</Code></Error>');
      return;
    }
    const headers = {
      'Content-Type': object.contentType,
      'Content-Length': object.body.length,
    };
    if (request.method === 'HEAD') send(response, 200, headers);
    else send(response, 200, headers, object.body);
    return;
  }

  if (request.method === 'DELETE') {
    objects.delete(key);
    send(response, 204);
    return;
  }

  send(response, 405);
});

await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const { port } = server.address();
const testFile = resolve(import.meta.dirname, '..', 'server', 'test', 'media-storage-s3.integration.test.js');
const child = spawn(process.execPath, ['--test', '--test-concurrency=1', testFile], {
  cwd: resolve(import.meta.dirname, '..'),
  env: {
    ...process.env,
    STORAGE_DRIVER: 's3',
    S3_ENDPOINT: `http://127.0.0.1:${port}`,
    S3_BUCKET: bucket,
    S3_REGION: 'us-east-1',
    S3_ACCESS_KEY_ID: 'e2e-access-key',
    S3_SECRET_ACCESS_KEY: 'e2e-secret-key',
  },
  stdio: 'inherit',
  windowsHide: true,
});

const exitCode = await new Promise((resolveExit) => {
  child.once('error', (error) => {
    console.error(error);
    resolveExit(1);
  });
  child.once('exit', (code, signal) => resolveExit(code ?? (signal ? 1 : 0)));
});
await new Promise((resolveClose) => server.close(resolveClose));
process.exit(exitCode);
