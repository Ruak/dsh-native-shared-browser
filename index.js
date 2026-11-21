/**
 * Host half of the native shared browser bundle.
 *
 * Keeps a small command queue that the Client half drains into the exact
 * Electron <webview> the user sees. The queue is plain memory: a local
 * single-user control channel, not persisted state.
 *
 * Access. The only HTTP routes are the two the page itself needs (`commands`,
 * `result`) plus `diag`; each one asks `ctx.connection.requestRejection` first,
 * which applies DSH's Host/Origin fence and requires this deployment's browser
 * credential. A page on another origin therefore cannot drive the shared tab,
 * and a missing connection service fails closed instead of leaving the queue
 * open. The agent gets the same queue through the `native_shared_browser` tool:
 * in-process, so it needs no HTTP credential and no unauthenticated route.
 */

import { randomUUID } from 'node:crypto';

const PENDING = new Map();
const RESULTS = new Map();
const MAX_RESULTS = 200;
const DEFAULT_WAIT_MS = 15000;
const MAX_WAIT_MS = 40000;
const MAX_RENDER_CHARS = 12000;
const ACTIONS = ['open', 'goto', 'eval', 'click', 'type'];

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

/**
 * Status the route must answer with, or 0 when DSH's fence admits the request.
 * Missing or throwing trust machinery fails closed.
 */
function authorizationStatus(ctx, request) {
  const connection = ctx.get('connection');
  if (!connection || typeof connection.requestRejection !== 'function') return 503;
  try {
    const rejection = connection.requestRejection({ headers: request.headers });
    return rejection === undefined ? 0 : rejection;
  } catch (error) {
    return 500;
  }
}

function rejectionMessage(status) {
  if (status === 401) return 'unauthorized: this route needs the DSH browser credential';
  if (status === 403) return 'forbidden: this authority is not trusted by this DSH deployment';
  if (status === 503) return 'access check unavailable: ctx.connection is not mounted';
  return 'access check failed';
}

function remember(id, payload) {
  RESULTS.set(id, payload);
  while (RESULTS.size > MAX_RESULTS) {
    const oldest = RESULTS.keys().next().value;
    RESULTS.delete(oldest);
  }
}

function enqueue(command) {
  const id = randomUUID();
  const entry = { id, ...command };
  PENDING.set(id, entry);
  return entry;
}

function takeResult(id) {
  const item = RESULTS.get(id);
  if (item === undefined) return undefined;
  RESULTS.delete(id);
  return item;
}

function handler(ctx, request, response) {
  const status = authorizationStatus(ctx, request);
  if (status !== 0) {
    json(response, { error: rejectionMessage(status) }, status);
    return;
  }
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
  if (url.pathname === '/plugins/native-shared-browser/commands' && request.method === 'GET') {
    json(response, { commands: [...PENDING.values()] });
    return;
  }
  if (url.pathname === '/plugins/native-shared-browser/result' && request.method === 'POST') {
    readJson(request).then(payload => {
      const command = PENDING.get(String(payload.id || ''));
      if (command) PENDING.delete(command.id);
      remember(String(payload.id || randomUUID()), {
        ...payload,
        at: new Date().toISOString(),
      });
      json(response, { ok: true });
    }).catch(error => json(response, { error: String(error.message || error) }, 400));
    return;
  }
  json(response, { error: 'not found' }, 404);
}

function clip(text) {
  return text.length <= MAX_RENDER_CHARS
    ? text
    : text.slice(0, MAX_RENDER_CHARS) + '\n… truncated ' + (text.length - MAX_RENDER_CHARS) + ' chars';
}

function waitMsFrom(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_WAIT_MS;
  return Math.min(Math.max(Math.trunc(parsed), 1000), MAX_WAIT_MS);
}

function buildCommand(args) {
  const action = String(args.action || '');
  if (!ACTIONS.includes(action)) throw new Error(`unsupported action: ${JSON.stringify(action)}`);
  const command = { action };
  if (action === 'open' || action === 'goto') {
    const target = String(args.url || '').trim();
    if (!/^https?:\/\//i.test(target)) throw new Error('url must be an absolute http(s) URL');
    command.url = target;
    return command;
  }
  if (action === 'eval') {
    const js = String(args.js || '');
    if (!js.trim()) throw new Error('js is required for action "eval"');
    command.js = js;
    return command;
  }
  const selector = String(args.selector || '').trim();
  if (!selector) throw new Error('selector is required for action "click" or "type"');
  command.selector = selector;
  if (action === 'type') command.text = String(args.text ?? '');
  return command;
}

/** Resolve with the page's result report, or reject when the page never answers. */
function waitForResult(id, waitMs, signal) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + waitMs;
    let finished = false;
    let timer;
    const cleanup = () => {
      if (timer !== undefined) clearInterval(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    };
    const settle = (error, value) => {
      if (finished) return;
      finished = true;
      cleanup();
      if (error) reject(error);
      else resolve(value);
    };
    const onAbort = () => settle(new Error('cancelled'));
    const tick = () => {
      const item = takeResult(id);
      if (item !== undefined) {
        settle(null, item);
        return;
      }
      if (Date.now() >= deadline) {
        settle(new Error(
          `the shared browser page did not answer within ${waitMs} ms; `
          + 'open the tab first with action "open" and retry',
        ));
      }
    };
    if (signal && signal.aborted) {
      onAbort();
      return;
    }
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    timer = setInterval(tick, 120);
  });
}

function toolDefinition() {
  return {
    name: 'native_shared_browser',
    description:
      'Operate the shared browser tab shown on the right, the page the user can also click. '
      + 'Actions: open/goto (url), eval (js), click (selector), type (selector, text). '
      + 'Returns what the page reported for the command. The tab must exist first: call action "open".',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: ACTIONS,
          description: 'open or goto a URL, evaluate JavaScript, click a selector, or type into one.',
        },
        url: { type: 'string', description: 'Absolute http(s) URL, for action "open" or "goto".' },
        js: { type: 'string', description: 'JavaScript expression to evaluate, for action "eval".' },
        selector: { type: 'string', description: 'CSS selector, for action "click" or "type".' },
        text: { type: 'string', description: 'Text written into the selector, for action "type".' },
        wait_ms: {
          type: 'integer',
          minimum: 1000,
          maximum: MAX_WAIT_MS,
          description: `How long to wait for the page result; default ${DEFAULT_WAIT_MS}.`,
        },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: clip(JSON.stringify(value, null, 2)) }],
    },
    timeoutMs: MAX_WAIT_MS + 10000,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const command = buildCommand(args || {});
      const entry = enqueue(command);
      const payload = await waitForResult(
        entry.id,
        waitMsFrom((args || {}).wait_ms),
        exec && exec.signal,
      );
      const body = payload.result;
      return {
        action: command.action,
        id: entry.id,
        ok: payload.ok === true,
        error: typeof payload.error === 'string' ? payload.error : '',
        url: body && typeof body.url === 'string' ? body.url : '',
        result: body === undefined ? null : body,
      };
    },
  };
}

export const inject = ['webServer', 'connection', 'tools'];

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/plugins/native-shared-browser',
    handler: (request, response) => handler(ctx, request, response),
  }), 'native-shared-browser: page routes');

  ctx.effect(() => ctx.tools.register(toolDefinition()), 'native-shared-browser: agent tool');
}
