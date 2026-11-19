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

让 agent 打开页面，或自己调用 Host 队列：

```powershell
Invoke-RestMethod "http://127.0.0.1:56852/plugins/native-shared-browser/open?url=https://example.com/"
```

右侧栏会出现一个「原生共享浏览器」标签，页面可直接交互；之后 agent 用命令 API 操作同一页面：

```powershell
$body = @{ action = 'eval'; js = 'document.title' } | ConvertTo-Json
$id = (Invoke-RestMethod -Method Post -ContentType 'application/json' -Body $body `
  'http://127.0.0.1:56852/plugins/native-shared-browser/command').id
Invoke-RestMethod "http://127.0.0.1:56852/plugins/native-shared-browser/results" | ConvertTo-Json -Depth 8
```

命令包含 `open {url}`、`goto {url}`、`eval {js}`、`click {selector}`、`type {selector, text}`。

## 安全与限制

- 控制接口绑定在 DSH 的 loopback 服务器上且**无鉴权**，只适用于本地单用户 Desktop；不要暴露到远程/共享环境。
- `eval`/`type` 拥有所打开页面的权限；不要把标签指向不可信页面，用完关掉标签即可。
- 命令触发导航时 JS 结果可能超时；把「点击」和「读取结果」拆成两条命令。
- 自带 Browser 标签上目前没有「共享」按钮；本插件提供自己的标签页。上游提案见 `docs/DETAIL.md`。

## 发布到 GitHub / npm

- GitHub 仓库建议加 **`dsh-plugin`** topic，便于社区发现；
- 需要 npm 安装时再 `npm publish --access public`（包名 `dsh-native-shared-browser`）。
- 重命名包名后同步更新 `package.json`、`cordis.patch.yml` 与本文档。

## License

MIT，见 [LICENSE](LICENSE)。
