# How it works

The bundle has two halves:

- **Client half** (`client.js`) registers a right-sidebar tab type
  `native-shared-browser` and renders a real Electron `<webview>`. It acquires
  the guest through `globalThis.dshDesktop.browser.acquire(...)`, the same
  lease/partition carrier the shipped Browser tab uses, loads the pending URL
  once on `dom-ready`, and reports readiness on `did-finish-load`. A poller reads
  the Host command queue every 1.2 s, executes commands with
  `webview.executeJavaScript`, and posts the result back.
- **Host half** (`index.js`) registers a loopback HTTP control queue on the DSH
  web server: `open`, `command`, `commands`, `result`, `results`, `diag`.

The page belongs to the user: clicks and typing are native. The agent side is
plain JavaScript evaluation in the same guest, behind a local unauthenticated
endpoint, so the security boundary is "local DSH profile" and "page you chose".

## Reference client (Python, UTF-8 safe)

```python
import json
import urllib.request

BASE = "http://127.0.0.1:56852/plugins/native-shared-browser"

def submit(command):
    data = json.dumps(command, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(BASE + "/command", data=data,
        headers={"content-type": "application/json; charset=utf-8"})
    return json.loads(urllib.request.urlopen(request).read())["id"]

command_id = submit({"action": "eval", "js": "document.title"})
with urllib.request.urlopen(BASE + "/results") as response:
    print(json.loads(response.read()))
```

## Why not the shipped Browser tab?

The shipped `@deepseek-ai/dsh-client-ui-sidebar-browser` owns its `<webview>`
inside its own React tree and exposes no toolbar slot or CDP/tool surface to
other plugins, so a community plugin cannot add a Share button to it or drive
it. The proper upstream fix would be a toolbar slot plus an explicit Share
action backed by a Host Remote (the same shape VS Code uses for its integrated
browser). This bundle is the community workaround: its own tab, same lease
carrier, local command queue.
