# Changelog

## 1.2.0

- The tab now belongs to the **Session that opened it**. DSH keeps one right
  Sidebar docking surface per Session and `ctx.sidebarRight.openTab` acts on the
  Session on screen, so an agent call made while the user was viewing another
  Session used to open the tab in that other panel. Commands now carry the
  originating Session (`exec.agent.id`), the client selects it before opening,
  and later `goto`/`eval`/`click`/`type` calls address that Session's own
  mounted webview — which keeps working while the user views another Session.
- One webview per Session (hidden Sessions keep theirs mounted through
  `keepMounted`), per-Session URL memory, and a per-Session browser lease key.
- A command for a Session whose tab was never opened reports that the tab must
  be opened first instead of driving another Session's page.

## 1.1.0

- Security: every HTTP route now runs behind
  `ctx.connection.requestRejection` — DSH's Host/Origin fence plus this
  deployment's browser credential. Cross-site requests get `403`,
  unauthenticated local requests `401`, and a missing connection service fails
  closed with `503`. The unauthenticated `open`, `command` and `results` routes
  are gone; the page keeps only `commands`, `result` and `diag`.
- Added the `native_shared_browser` agent tool: the agent drives the same queue
  in-process and gets the page's result in one call.
- Completed results are kept in a 200-entry ring instead of growing without
  bound.

## 1.0.1

- `open` on an already-mounted shared tab now navigates it to the new URL
  instead of silently reusing the previous page.

## 1.0.0

- First public community release.
- Right-sidebar native `<webview>` tab acquired through
  `dshDesktop.browser.acquire(...)`.
- Host command queue: `open`, `goto`, `eval`, `click`, `type`, with a
  `GET /open?url=` convenience route.
- Single-document load on `dom-ready` (no reload loop) and `did-finish-load`
  readiness gating.
