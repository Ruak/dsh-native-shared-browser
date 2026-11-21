# dsh-native-shared-browser（中文）

给 **DeepSeek Harness（DSH）** 用的社区插件：在右侧栏注册一个**真实 Electron `<webview>`** 浏览器标签页，用户可以直接点击/输入，agent 通过本地命令队列在**同一个页面**里执行 JavaScript。它不是截图/实时镜像。

> 状态：社区插件，仅 Desktop。基于 DSH `0.2.2-rc.3` 验证（Windows 打包版 Desktop）。

## 它解决什么

DSH 自带右侧栏 Browser 可以原生浏览网页，但 client 插件无法驱动那个标签，自带 Browser 也没有 toolbar 插槽来加「共享给 agent」按钮。本插件注册自己的侧栏标签类型，guest 通过与自带 Browser 相同的 `globalThis.dshDesktop.browser` 通道取得 lease/partition，再用本地控制队列把「agent 操作同一个可见页面」补齐。

## 安装

1. `git clone` 本仓库；
2. DSH → **Plugins** → **Add plugin**，选择仓库目录（或调用 `plugin_manager` 的 `install_bundle` 传入绝对目录）；
3. 等插件行变绿；初始不会自动开标签，等你/agent 共享第一个页面。

## 快速开始

让 agent 打开页面即可，它调用 `native_shared_browser` 工具：

- `action: "open"` + `url: "https://example.com/"`：在右侧栏打开**原生共享浏览器**标签；
- `action: "eval"` + `js: "document.title"`：在同一个页面里执行 JavaScript；
- `action: "click"` / `action: "type"`：按 CSS 选择器点击或输入；`action: "goto"` 让已挂载的标签导航。

每次调用都会返回页面自己的执行结果。标签就是一个正常页面，你可以随时自己点击、输入。

页面只通过 DSH 同源的两条路由与 Host 通信：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/plugins/native-shared-browser/commands` | 页面轮询待执行命令。 |
| `POST` | `/plugins/native-shared-browser/result` | 页面回报一条命令结果。 |
| `GET` | `/plugins/native-shared-browser/diag` | 运行时信息（Electron 版本、队列长度）。 |

这三条都经过 `ctx.connection.requestRejection`：只接受本 DSH 部署里已认证的浏览器。其它源的网页调用得到 `403`，本机但没有浏览器凭据的调用得到 `401`。

## 命令

| 动作 | 参数 | 效果 |
| --- | --- | --- |
| `open` | `url` | 打开共享标签到绝对 http(s) 地址，或让它导航过去。 |
| `goto` | `url` | 让已挂载的标签导航。 |
| `eval` | `js` | 以页面自身 origin/session 执行 JavaScript，等同在 DevTools 里输入。 |
| `click` | `selector` | 点击选择器命中的第一个元素。 |
| `type` | `selector`、`text` | 聚焦元素、写入值并触发 `input`/`change`。 |

`wait_ms`（1000–40000，默认 15000）表示一次工具调用等待页面回报的时长。

## 安全与限制

- 页面路由由 DSH 自己的请求检查把关：Host/Origin 栅栏 + 本部署的浏览器凭据。没有给 agent 的未认证 HTTP 入口，agent 走进程内工具。
- `eval`/`type` 拥有所打开页面的权限；不要把标签指向不可信页面，用完关掉标签即可。
- 命令触发导航时 JS 结果可能超时；把「点击」和「读取结果」拆成两条命令。
- 自带 Browser 标签上目前没有「共享」按钮；本插件提供自己的标签页。上游提案见 `docs/DETAIL.md`。

## 发布到 GitHub / npm

- GitHub 仓库建议加 **`dsh-plugin`** topic，便于社区发现；
- 需要 npm 安装时再 `npm publish --access public`（包名 `dsh-native-shared-browser`）。
- 重命名包名后同步更新 `package.json`、`cordis.patch.yml` 与本文档。

## License

MIT，见 [LICENSE](LICENSE)。

## 插件索引 / Discover

DSH 没有集中式官方索引：Plugins 页的实验性 **Discover** 标签只列出用户自己添加的索引源。本仓库发布了一个 format-1 索引：

```
https://raw.githubusercontent.com/Ruak/dsh-native-shared-browser/main/plugin-index.json
```

使用方法：

1. Plugins → Experimental plugins → 打开 **Custom plugin indexes**（`dsh-experimental-plugin-market-bundle` 可选组合包）；
2. Plugins → **Discover** → **Index sources** → **Add index source**，粘贴上面的 URL；
3. 搜索 `原生共享浏览器`（或 `native shared browser`）并安装。

仓库也已设置官方 CONTRIBUTING 推荐的 `dsh-plugin` GitHub topic。
