/**
 * Client half of the native shared browser bundle.
 *
 * Registers a right-sidebar tab type whose body is a real Electron <webview>.
 * On Desktop the guest is acquired through the same `dshDesktop.browser`
 * carrier the shipped Browser tab uses, so the native window policy accepts it.
 * The user can click and type in the page directly; the agent drives the same
 * live page through the Host half's command queue.
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

    const carrier = globalThis.dshDesktop;
    const bridge = carrier && carrier.protocolVersion === 1 ? carrier.browser : undefined;

    let activeWebview = null;
    let activeLease = null;
    let activeUrl = 'https://example.com/';
    let pendingUrl = 'https://example.com/';
    let tabOpened = false;
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

    async function acquireLease() {
      if (!bridge) return undefined;
      const reservation = await bridge.acquire(WORKSPACE_KEY);
      activeLease = reservation.lease;
      return reservation;
    }

    function releaseLease() {
      const lease = activeLease;
      activeLease = null;
      if (bridge && lease) bridge.release(lease).catch(() => {});
    }

    function webviewId(view) {
      try { return view?.getWebContentsId?.() ?? null; } catch (error) { return 'error: ' + String(error); }
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

    function waitReady(view, timeoutMs = 25000) {
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

    async function runCommand(command) {
      if (command.action === 'open') {
        pendingUrl = String(command.url || pendingUrl);
        activeUrl = pendingUrl;
        tabOpened = true;
        return { opened: true, url: pendingUrl };
      }
      if (command.action === 'goto') {
        const view = await waitReady(activeWebview);
        pendingUrl = String(command.url || pendingUrl);
        await view.loadURL(pendingUrl);
        activeUrl = pendingUrl;
        return { navigated: pendingUrl };
      }
      const view = await waitReady(activeWebview);
      if (command.action === 'eval' || command.action === 'js') {
        const value = await withTimeout(
          view.executeJavaScript(String(command.js || ''), true),
          20000,
          'eval',
        );
        activeUrl = await withTimeout(
          view.executeJavaScript('location.href', true),
          5000,
          'location',
        ).catch(() => activeUrl);
        return { value, url: activeUrl, webviewId: webviewId(view) };
      }
      if (command.action === 'click') {
        const selector = String(command.selector || '');
        return await view.executeJavaScript(
          `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return { clicked: false }; el.click(); return { clicked: true }; })()`,
          true,
        );
      }
      if (command.action === 'type') {
        const selector = String(command.selector || '');
        const text = String(command.text || '');
        return await view.executeJavaScript(
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
              const targetUrl = String(command.url || pendingUrl);
              if (!tabOpened || !activeWebview) {
                pendingUrl = targetUrl;
                activeUrl = targetUrl;
                tabOpened = true;
                ctx.sidebarRight.openTab(TAB_KIND, { params: { url: targetUrl } });
                executed.add(command.id);
                await report(command, true, { opened: true, url: targetUrl });
                continue;
              }
              const view = await withTimeout(waitReady(activeWebview), 30000, 'open');
              const previous = activeUrl;
              pendingUrl = targetUrl;
              activeUrl = targetUrl;
              if (previous !== targetUrl) await view.loadURL(targetUrl);
              executed.add(command.id);
              await report(command, true, {
                opened: true,
                reused: true,
                navigated: previous !== targetUrl,
                url: targetUrl,
              });
              continue;
            }
            const result = await withTimeout(runCommand(command), 30000, command.action);
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

    function SharedBrowserBody() {
      const hostRef = React.useRef(null);
      React.useEffect(() => {
        const host = hostRef.current;
        if (!host) return undefined;
        let cancelled = false;
        let view;
        const cleanup = () => {
          cancelled = true;
          if (view) view.remove();
          if (activeWebview === view) activeWebview = null;
          releaseLease();
        };
        (async () => {
          try {
            if (!bridge) throw new Error('desktop browser carrier is unavailable');
            const reservation = await acquireLease();
            if (cancelled) return;
            view = document.createElement('webview');
            view.setAttribute('name', reservation.lease);
            view.setAttribute('partition', reservation.partition);
            view.setAttribute('allowpopups', '');
            view.setAttribute('src', 'about:blank#' + reservation.lease);
            view.style.cssText = 'width:100%;height:100%;flex:1 1 auto;border:0;background:#fff;';
            view.addEventListener('dom-ready', () => {
              note('guest-dom-ready');
              view.loadURL(pendingUrl).catch(error => note('loadURLError:' + String(error)));
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
            note('mounted:' + reservation.lease);
          } catch (error) {
            note('mountError:' + String(error && error.message ? error.message : error));
          }
        })();
        return cleanup;
      }, []);
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
      inject: ['slots', 'sidebarRight', 'sidebarRightTabs'],
      apply(ctx) {
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
