# dsh-native-shared-browser

A native right-sidebar browser tab for **DeepSeek Harness (DSH)** that the user
and the agent operate **together**: one real Electron `<webview>`, two operators.
This is not a screenshot mirror — the agent evaluates JavaScript in the same live
page the user sees and can click through.

> **Status:** community plugin, Desktop only. Built against DSH `0.2.2-rc.3` and
> verified on Windows with the packaged Desktop profile.

## Why

The shipped right-sidebar Browser lets you browse pages natively, but a client
plugin cannot drive that tab and there is no toolbar slot to add a first-party
"Share with agent" action. This bundle registers its **own** sidebar tab type
whose guest is acquired through the same `globalThis.dshDesktop.browser` carrier
and partition path the shipped Browser tab uses, then exposes a small local
control queue so the agent can evaluate JavaScript in that exact page.

## Requirements

- DSH **Desktop** profile (the real `<webview>` path); Web profiles have no
  `<webview>` tag.
- The optional `webServer` and `ui-sidebar-right` packages are part of the
  Desktop/Web composition; no extra configuration is needed.

## Install

### From a local checkout (works today)

1. Download/clone this repository.
2. Open DSH → **Plugins** → **Add plugin**, and choose the cloned directory
   (or call `plugin_manager`'s `install_bundle` with the absolute directory).
3. Wait for the bundle row to turn green. The sidebar tab type is installed but
   no tab is opened until a page is shared.

### From npm (after `npm publish`)

Install the package `dsh-native-shared-browser` through the same Plugins page or
`install_bundle` spec. Until a release is published, use the local-directory
method above.

## Quick start

Ask the agent to open a page; it calls the `native_shared_browser` tool:

- `action: "open"`, `url: "https://example.com/"` opens the right-sidebar
  **Native shared browser** tab on that URL.
- `action: "eval"`, `js: "document.title"` runs JavaScript in that same page.
- `action: "click"` / `action: "type"` drive a CSS selector; `action: "goto"`
  navigates the mounted tab.

Every call returns what the page reported. The tab is a normal page: you can
click and type in it yourself at any time.

## Session ownership

Each Session has its own right Sidebar panel, and the tab belongs to the Session
that opened it: an agent call in another Session opens the browser in **that**
Session's panel (selecting it if needed), never in whichever Session you happen
to be viewing. Later `eval`/`click`/`type` calls address that Session's own
page, which stays alive while you view another one.

The page talks to the Host over the DSH origin only:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/plugins/native-shared-browser/commands` | The page polls pending commands. |
| `POST` | `/plugins/native-shared-browser/result` | The page reports one command result. |
| `GET` | `/plugins/native-shared-browser/diag` | Runtime facts (Electron version, queue sizes). |

All three run behind `ctx.connection.requestRejection`, so they accept only
this DSH deployment's authenticated browser. A page on another origin gets
`403`; a local client without the browser credential gets `401`.

## Command API

| Action | Arguments | Effect |
| --- | --- | --- |
| `open` | `url` | Open the shared tab on an absolute http(s) URL, or navigate it. |
| `goto` | `url` | Navigate the mounted tab. |
| `eval` | `js` | Evaluate JavaScript with the page's own origin/session, as if typed into DevTools. |
| `click` | `selector` | Click the first element matching the selector. |
| `type` | `selector`, `text` | Focus the element, set its value and fire `input`/`change`. |

`wait_ms` (1 000–40 000, default 15 000) is how long one tool call waits for
the page to report back.

## Security and limitations

- The page routes are fenced by DSH's own request check: Host/Origin plus the
  browser credential of this deployment. There is no unauthenticated agent
  route — the agent uses the in-process tool instead.
- `eval`/`type` have the privileges of the page you open. Do not point the shared
  tab at untrusted pages, and revoke by closing the tab when finished.
- The tab's JS bridge can time out when a command triggers a navigation; send a
  click and read the result as separate commands.
- There is currently no Share button on the shipped Browser tab: this plugin
  provides its own tab instead. See `docs/DETAIL.md` for the upstream proposal.

## Repository setup

- Add the GitHub topic **`dsh-plugin`** so the project is discoverable through
  DSH's plugin convention.
- Keep the `dsh-plugin` topic, description and README in sync when you rename the
  package or publish it to npm.

## License

MIT — see [LICENSE](LICENSE).

## Discover / plugin index

DSH has no central official index: the optional **Discover** tab of the Plugins
page lists only the index sources a user adds. This repository publishes a
format-1 index at:

```
https://raw.githubusercontent.com/Ruak/dsh-native-shared-browser/main/plugin-index.json
```

To use it:

1. Plugins -> Experimental plugins -> enable **Custom plugin indexes** (the
   `dsh-experimental-plugin-market-bundle` optional bundle).
2. Plugins -> **Discover** -> **Index sources** -> **Add index source** and paste
   the URL above.
3. Search for `native shared browser` and install the entry.

The GitHub topic `dsh-plugin` is also set, which is the discovery convention
recommended by the official CONTRIBUTING guide.
