# How it works

The bundle has two halves:

- **Client half** (`client.js`) registers a right-sidebar tab type
  `native-shared-browser` and renders a real Electron `<webview>`. It acquires
  the guest through `globalThis.dshDesktop.browser.acquire(...)`, the same
  lease/partition carrier the shipped Browser tab uses, loads the pending URL
  once on `dom-ready`, and reports readiness on `did-finish-load`. A poller reads
  the Host command queue every 1.2 s, executes commands with
  `webview.executeJavaScript`, and posts the result back.
- **Host half** (`index.js`) keeps the command queue, registers the three routes
  the page uses (`commands`, `result`, `diag`) behind
  `ctx.connection.requestRejection`, and registers the
  `native_shared_browser` tool for the agent.

The page belongs to the user: clicks and typing are native. The agent side is
plain JavaScript evaluation in the same guest, reached through an in-process
tool; the HTTP routes accept only this deployment's authenticated browser, so
the security boundary is "this DSH profile's own page", not "any local
process".

## Agent tool

`native_shared_browser` queues one command and waits for the page to report it:

| Action | Arguments | Effect |
| --- | --- | --- |
| `open` | `url` | Open the shared tab (or navigate it). |
| `goto` | `url` | Navigate the mounted tab. |
| `eval` | `js` | Evaluate JavaScript in the page. |
| `click` | `selector` | Click the first match. |
| `type` | `selector`, `text` | Write text into the match. |

`wait_ms` bounds how long the call waits (1 s–40 s, default 15 s). A tab must
exist first: call `open` once. Commands the page never answers stay queued;
results are kept in a 200-entry ring.

## Route access

All three routes call `ctx.connection.requestRejection({ headers })` before
doing anything. That applies DSH's Host/Origin fence (DNS-rebinding and
cross-site defence) and requires the browser credential this deployment minted.
A missing `connection` service answers `503` instead of leaving the queue open.
`401` and `403` carry a short reason in the JSON body.

## Why not the shipped Browser tab?

The shipped `@deepseek-ai/dsh-client-ui-sidebar-browser` owns its `<webview>`
inside its own React tree and exposes no toolbar slot or CDP/tool surface to
other plugins, so a community plugin cannot add a Share button to it or drive
it. The proper upstream fix would be a toolbar slot plus an explicit Share
action backed by a Host Remote (the same shape VS Code uses for its integrated
browser). This bundle is the community workaround: its own tab, same lease
carrier, local command queue.
