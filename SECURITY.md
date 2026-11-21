# Security policy

`dsh-native-shared-browser` serves three HTTP routes on the DSH web server for
the page it renders (`commands`, `result`, `diag`). Every request is checked by
`ctx.connection.requestRejection` first: DSH's Host/Origin fence plus this
deployment's browser credential. Cross-site requests are refused (`403`),
requests without the credential are refused (`401`), and a missing connection
service fails closed (`503`). The agent does not use these routes; it calls the
in-process `native_shared_browser` tool.

- Do not expose the DSH web server on a public interface while this plugin is
  enabled.
- Commands execute JavaScript with the privileges of the page in the shared tab.
  Only open pages you trust; close the tab to stop sharing.
- Do not page through untrusted content with stored credentials in the same
  webview partition.
- Report security issues by opening a GitHub security advisory on this repository
  rather than a public issue.
