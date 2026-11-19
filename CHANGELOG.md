# Changelog

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
