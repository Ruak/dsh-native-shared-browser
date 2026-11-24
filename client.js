/**
 * Client half of the native shared browser bundle.
 *
 * Registers a right-sidebar tab type whose body is a real Electron <webview>.
 * On Desktop the guest is acquired through the same `dshDesktop.browser`
 * carrier the shipped Browser tab uses, so the native window policy accepts it.
 * The user can click and type in the page directly; the agent drives the same
 * live page through the Host half's command queue.
 *
 * Session binding: the right Sidebar holds one docking surface per Session, and
 * `ctx.sidebarRight.openTab` acts on the Session on screen. A command therefore
 * carries the Session that issued it (`command.session`); before opening, this
 * half selects that Session so the tab lands in its own panel instead of
 * whichever panel the user happens to be viewing. Later commands address the
 * webview mounted for their own Session, which keeps working while the user
 * views another one.
 */

window.__ModuleLoader__.load({
  id: 'dsh-native-shared-browser',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NAMESPACE = 'nativeSharedBrowser';
    const TAB_KIND = 'native-shared-browser';
    const TAB_ID = 'dsh-native-shared-browser';
    const WORKSPACE_KEY = 'session:shared-browser';
    const COMMANDS_ROUTE = '/plugins/native-shared-browser/commands';
    const RESULT_ROUTE = '/plugins/native-shared-browser/result';
    const SESSION_SWITCH_TIMEOUT_MS = 10000;
    const VIEW_READY_TIMEOUT_MS = 25000;
    const CLIENT_VERSION = '1.2.0';

    const carrier = globalThis.dshDesktop;
    const bridge = carrier && carrier.protocolVersion === 1 ? carrier.browser : undefined;

    let activeWebview = null;
    let activeLease = null;
    let activeUrl = 'https://example.com/';
    let pendingUrl = 'https://example.com/';
    let onScreenSession;
    const sessionUrls = new Map();
    const sessionViews = new Map();
    let polling = false;
    const executed = new Set();
    const debug = { bridge: Boolean(bridge), events: [] };

    function note(event) {
      if (debug.events.length > 30) debug.events.shift();
      debug.events.push(event);
    }

    function withTimeout(promise, timeoutMs, label) {
      return Promise.race([
        promise,
        new Promise((resolve, reject) => {
          setTimeout(() => reject(new Error(label + ' timed out')), timeoutMs);
        }),
      ]);
    }

    async function acquireLease(sessionId) {
      if (!bridge) return undefined;
      const key = sessionId ? WORKSPACE_KEY + ':' + sessionId : WORKSPACE_KEY;
      const reservation = await bridge.acquire(key);
      activeLease = reservation.lease;
      return reservation;
    }

    function releaseLease(lease) {
      if (activeLease === lease) activeLease = null;
      if (bridge && lease) bridge.release(lease).catch(() => {});
    }

    function webviewId(view) {
      try { return view?.getWebContentsId?.() ?? null; } catch (error) { return 'error: ' + String(error); }
    }

    function viewFor(sessionId) {
      if (sessionId && sessionViews.has(sessionId)) return sessionViews.get(sessionId);
      return activeWebview;
    }

    function initialUrlFor(sessionId) {
      return (sessionId && sessionUrls.get(sessionId)) || pendingUrl;
    }

    function sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    function waitFor(predicate, timeoutMs, label) {
      return new Promise((resolve, reject) => {
        const started = Date.now();
        const tick = () => {
          let value;
          try { value = predicate(); } catch (error) { value = undefined; }
          if (value) { resolve(value); return; }
          if (Date.now() - started > timeoutMs) { reject(new Error(label + ' timed out')); return; }
          setTimeout(tick, 100);
        };
        tick();
      });
    }

    function waitForSessionView(sessionId, timeoutMs = VIEW_READY_TIMEOUT_MS) {
      if (!sessionId) {
        if (activeWebview) return Promise.resolve(activeWebview);
        return Promise.reject(new Error('webview is not mounted'));
      }
      return waitFor(() => sessionViews.get(sessionId), timeoutMs, 'shared browser tab ("' + sessionId + '")');
    }

    /** Select the Session whose Sidebar should hold the tab, then wait until it is on screen. */
    async function revealSession(ctx, sessionId) {
      if (!sessionId) return true;
      if (onScreenSession === sessionId) return true;
      const workspace = ctx.get('uiWorkspace');
      if (!workspace || typeof workspace.openSession !== 'function') {
        note('openSessionUnavailable');
        return false;
      }
      try {
        workspace.openSession(sessionId);
        note('openSession:' + sessionId);
      } catch (error) {
        note('openSessionError:' + String(error && error.message ? error.message : error));
        return false;
      }
      try {
        await waitFor(() => onScreenSession === sessionId, SESSION_SWITCH_TIMEOUT_MS, 'session switch');
        return true;
      } catch (error) {
        note('sessionSwitchTimeout:' + sessionId);
        return false;
      }
    }

    /** Open the tab once the on-screen Session has adopted its surface store. */
    async function openTabWhenReady(ctx, url, sessionId) {
      let lastError;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        try {
          if (sessionId) sessionUrls.set(sessionId, url);
          ctx.sidebarRight.openTab(TAB_KIND, { params: { url } });
          return;
        } catch (error) {
          lastError = error;
          await sleep(100);
        }
      }
      throw lastError instanceof Error ? lastError : new Error('openTab failed');
    }

    async function report(command, ok, result, error) {
      try {
        await fetch(RESULT_ROUTE, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: command.id, ok, result: result ?? null, error: error || '' }),
        });
      } catch (reportError) {
        /* keep the command pending for the next poll */
      }
    }

    function waitReady(view, timeoutMs = VIEW_READY_TIMEOUT_MS) {
      if (!view) return Promise.reject(new Error('webview is not mounted'));
      if (view.dataset.dshReady === '1') return Promise.resolve(view);
      return new Promise((resolve, reject) => {
        const started = Date.now();
        const timer = setInterval(() => {
          if (view.dataset.dshReady === '1') {
            clearInterval(timer);
            resolve(view);
          } else if (Date.now() - started > timeoutMs) {
            clearInterval(timer);
            reject(new Error('webview not ready; ' + JSON.stringify({ ...debug, webviewId: webviewId(view) })));
          }
        }, 200);
      });
    }

    async function runCommand(command, view) {
      if (command.action === 'goto') {
        const ready = await waitReady(view);
        const target = String(command.url || pendingUrl);
        await ready.loadURL(target);
        if (command.session) sessionUrls.set(command.session, target);
        else activeUrl = target;
        return { navigated: target };
      }
      const ready = await waitReady(view);
      if (command.action === 'eval' || command.action === 'js') {
        const value = await withTimeout(
          ready.executeJavaScript(String(command.js || ''), true),
          20000,
          'eval',
        );
        const url = await withTimeout(
          ready.executeJavaScript('location.href', true),
          5000,
          'location',
        ).catch(() => '');
        return { value, url, webviewId: webviewId(ready) };
      }
      if (command.action === 'click') {
        const selector = String(command.selector || '');
        return await ready.executeJavaScript(
          `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return { clicked: false }; el.click(); return { clicked: true }; })()`,
          true,
        );
      }
      if (command.action === 'type') {
        const selector = String(command.selector || '');
        const text = String(command.text || '');
        return await ready.executeJavaScript(
          `(() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return { typed: false };
            el.focus();
            const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
            setter ? setter.call(el, ${JSON.stringify(text)}) : (el.value = ${JSON.stringify(text)});
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return { typed: true };
          })()`,
          true,
        );
      }
      throw new Error('unknown command action: ' + String(command.action));
    }

    async function handleOpen(ctx, command) {
      const sessionId = typeof command.session === 'string' ? command.session : '';
      const targetUrl = String(command.url || pendingUrl);
      const selected = await revealSession(ctx, sessionId);
      if (sessionId && !selected) {
        note('openWithoutSelection:' + sessionId);
      }
      const existing = sessionId ? sessionViews.get(sessionId) : activeWebview;
      if (existing) {
        const previous = sessionId ? (sessionUrls.get(sessionId) || '') : activeUrl;
        if (sessionId) sessionUrls.set(sessionId, targetUrl);
        else { pendingUrl = targetUrl; activeUrl = targetUrl; }
        if (previous && previous !== targetUrl) await (await waitReady(existing)).loadURL(targetUrl);
        return { opened: true, reused: true, navigated: previous !== targetUrl, url: targetUrl, session: sessionId, clientVersion: CLIENT_VERSION };
      }
      if (sessionId) sessionUrls.set(sessionId, targetUrl);
      else { pendingUrl = targetUrl; activeUrl = targetUrl; }
      await openTabWhenReady(ctx, targetUrl, sessionId);
      const view = await waitForSessionView(sessionId);
      await waitReady(view);
      return { opened: true, url: targetUrl, session: sessionId, webviewId: webviewId(view), clientVersion: CLIENT_VERSION };
    }

    async function poll(ctx) {
      if (polling) return;
      polling = true;
      try {
        let commands = [];
        try {
          const response = await fetch(COMMANDS_ROUTE, { cache: 'no-store' });
          if (!response.ok) return;
          const payload = await response.json();
          commands = Array.isArray(payload.commands) ? payload.commands : [];
        } catch (error) {
          return;
        }
        for (const command of commands) {
          if (!command || typeof command.id !== 'string' || executed.has(command.id)) continue;
          try {
            if (command.action === 'open') {
              executed.add(command.id);
              const result = await withTimeout(handleOpen(ctx, command), 40000, 'open');
              await report(command, true, result);
              continue;
            }
            const sessionId = typeof command.session === 'string' ? command.session : '';
            const view = sessionId ? sessionViews.get(sessionId) : activeWebview;
            if (!view) {
              throw new Error(
                sessionId
                  ? 'the shared browser tab is not open in this Session; call action "open" first'
                  : 'the shared browser tab is not open; call action "open" first',
              );
            }
            const result = await withTimeout(runCommand(command, view), 30000, command.action);
            executed.add(command.id);
            await report(command, true, result);
          } catch (error) {
            executed.add(command.id);
            await report(command, false, null, String(error && error.message ? error.message : error));
          }
        }
      } finally {
        polling = false;
      }
    }

    function SharedBrowserBody(props) {
      const sessionId = props && typeof props.sessionId === 'string' ? props.sessionId : '';
      const hostRef = React.useRef(null);
      React.useEffect(() => {
        const host = hostRef.current;
        if (!host) return undefined;
        let cancelled = false;
        let view;
        let lease;
        const cleanup = () => {
          cancelled = true;
          if (view) view.remove();
          if (sessionId && sessionViews.get(sessionId) === view) sessionViews.delete(sessionId);
          if (activeWebview === view) activeWebview = null;
          releaseLease(lease);
        };
        (async () => {
          try {
            if (!bridge) throw new Error('desktop browser carrier is unavailable');
            const reservation = await acquireLease(sessionId);
            if (cancelled) return;
            lease = reservation.lease;
            const sourceUrl = initialUrlFor(sessionId);
            view = document.createElement('webview');
            view.setAttribute('name', reservation.lease);
            view.setAttribute('partition', reservation.partition);
            view.setAttribute('allowpopups', '');
            view.setAttribute('src', 'about:blank#' + reservation.lease);
            view.style.cssText = 'width:100%;height:100%;flex:1 1 auto;border:0;background:#fff;';
            view.addEventListener('dom-ready', () => {
              note('guest-dom-ready');
              view.loadURL(sourceUrl).catch(error => note('loadURLError:' + String(error)));
            }, { once: true });
            view.addEventListener('did-finish-load', () => {
              view.dataset.dshReady = '1';
              note('guest-did-finish-load');
            });
            view.addEventListener('did-fail-load', event => {
              note('guest-did-fail-load:' + (event.errorCode || '') + ':' + (event.errorDescription || ''));
            });
            host.appendChild(view);
            activeWebview = view;
            if (sessionId) sessionViews.set(sessionId, view);
            note('mounted:' + reservation.lease + (sessionId ? ':' + sessionId : ''));
          } catch (error) {
            note('mountError:' + String(error && error.message ? error.message : error));
          }
        })();
        return cleanup;
      }, [sessionId]);
      return h('div', {
        ref: hostRef,
        style: { width: '100%', height: '100%', display: 'flex', background: '#fff' },
      });
    }

    const typeDefinition = {
      id: TAB_ID,
      kind: TAB_KIND,
      multiple: false,
      priority: 'builtin',
      keepMounted: true,
      title: () => '共享浏览器',
    };

    return {
      inject: ['slots', 'sidebarRight', 'sidebarRightTabs', 'uiWorkspace'],
      apply(ctx) {
        ctx.effect(() => {
          const read = () => { onScreenSession = ctx.sidebarRight.mounted.getSnapshot(); };
          read();
          return ctx.sidebarRight.mounted.subscribe(read);
        }, 'native-shared-browser: on-screen session');
        ctx.effect(() => ctx.sidebarRightTabs.register(typeDefinition), 'native-shared-browser: tab type');
        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: TAB_ID,
          locale: NAMESPACE,
        }, SharedBrowserBody)), 'native-shared-browser: tab body');
        ctx.effect(() => {
          const timer = setInterval(() => { void poll(ctx); }, 1200);
          void poll(ctx);
          return () => clearInterval(timer);
        }, 'native-shared-browser: command poll');
      },
    };
  },
});
