/**
 * Host half of the native shared browser bundle.
 *
 * Keeps a tiny command queue so the Session agent (through shell HTTP calls or
 * a future tool) can drive the exact Electron <webview> that the Client half
 * renders in the right sidebar.  The queue is plain memory: it is a local
 * single-user control channel, not persisted state.
 */

import { randomUUID } from 'node:crypto';

const PENDING = new Map();
const RESULTS = new Map();

function json(response, payload, status = 200) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  return await new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) {
        reject(new Error('body too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

function handler(request, response) {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/plugins/native-shared-browser/diag') {
    json(response, {
      electron: process.versions.electron || null,
      platform: process.platform,
      pending: PENDING.size,
      results: RESULTS.size,
    });
    return;
  }
  if (url.pathname === '/plugins/native-shared-browser/open' && (request.method === 'GET' || request.method === 'POST')) {
    const target = String(url.searchParams.get('url') || '').trim();
    if (!/^https?:\/\//i.test(target)) {
      json(response, { error: 'url must be an absolute http(s) URL' }, 400);
      return;
    }
    const id = randomUUID();
    PENDING.set(id, { id, action: 'open', url: target });
    json(response, { id, url: target });
    return;
  }
  if (url.pathname === '/plugins/native-shared-browser/commands' && request.method === 'GET') {
    json(response, { commands: [...PENDING.values()] });
    return;
  }
  if (url.pathname === '/plugins/native-shared-browser/command' && request.method === 'POST') {
    readJson(request).then(payload => {
      const id = randomUUID();
      const command = { id, ...payload };
      PENDING.set(id, command);
      json(response, { id });
    }).catch(error => json(response, { error: String(error.message || error) }, 400));
    return;
  }
  if (url.pathname === '/plugins/native-shared-browser/result' && request.method === 'POST') {
    readJson(request).then(payload => {
      const command = PENDING.get(String(payload.id || ''));
      if (command) PENDING.delete(command.id);
      RESULTS.set(String(payload.id || randomUUID()), {
        ...payload,
        at: new Date().toISOString(),
      });
      json(response, { ok: true });
    }).catch(error => json(response, { error: String(error.message || error) }, 400));
    return;
  }
  if (url.pathname === '/plugins/native-shared-browser/results' && request.method === 'GET') {
    const since = url.searchParams.get('since');
    const all = [...RESULTS.entries()];
    const filtered = since ? all.filter(([, item]) => item.at > since) : all;
    json(response, { results: filtered.map(([id, item]) => ({ id, ...item })) });
    return;
  }
  json(response, { error: 'not found' }, 404);
}

export const inject = ['webServer'];

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/plugins/native-shared-browser',
    handler,
  }), 'native-shared-browser: control routes');
}
