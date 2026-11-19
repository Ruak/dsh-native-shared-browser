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

Ask the agent to open a page (or call the Host queue yourself). The command queue
is served by the DSH web server on the loopback origin:

```powershell
# Windows PowerShell
Invoke-RestMethod "http://127.0.0.1:56852/plugins/native-shared-browser/open?url=https://example.com/"
```

```bash
# curl
curl "http://127.0.0.1:56852/plugins/native-shared-browser/open?url=https://example.com/"
```

A right-sidebar **共享浏览器 / Native shared browser** tab opens on that URL. You
can click and type in it immediately.

From then on the agent drives the same page through the command API:

```powershell
$body = @{ action = 'eval'; js = 'document.title' } | ConvertTo-Json
$id = (Invoke-RestMethod -Method Post -ContentType 'application/json' -Body $body `
  'http://127.0.0.1:56852/plugins/native-shared-browser/command').id
Invoke-RestMethod "http://127.0.0.1:56852/plugins/native-shared-browser/results" |
  ConvertTo-Json -Depth 8
```

Prefer Python or another UTF-8-safe client when the JavaScript contains non-ASCII
text. A small reference client is shown in `docs/DETAIL.md`.

## Command API

| Method | Path | Body / query | Purpose |
| --- | --- | --- | --- |
| `GET` | `/plugins/native-shared-browser/open` | `?url=` | Enqueue an `open` command; the tab opens on the next poll. |
| `POST` | `/plugins/native-shared-browser/command` | JSON command | Enqueue one command and return its `id`. |
| `GET` | `/plugins/native-shared-browser/commands` | — | Read pending commands (the Client polls this). |
| `POST` | `/plugins/native-shared-browser/result` | `{id, ok, result, error}` | Client reports a command result. |
| `GET` | `/plugins/native-shared-browser/results` | `?since=` | Read completed results. |
| `GET` | `/plugins/native-shared-browser/diag` | — | Host runtime facts (Electron version, queue sizes). |

Commands: `open {url}`, `goto {url}`, `eval {js}`, `click {selector}`,
`type {selector, text}`. `eval` runs with the page's own origin/session, as if
typed into DevTools.

## Security and limitations

- The control endpoints are bound to the loopback DSH server and are
  **unauthenticated**. They are intended for the local single-user Desktop
  profile, not for shared/remote deployments.
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
