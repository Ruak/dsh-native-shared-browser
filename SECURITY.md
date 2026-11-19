# Security policy

`dsh-native-shared-browser` runs a local, **unauthenticated** HTTP control queue on
the DSH loopback web server. It is intended for the local single-user Desktop
profile only.

- Do not expose the DSH web server on a public interface while this plugin is
  enabled.
- Commands execute JavaScript with the privileges of the page in the shared tab.
  Only open pages you trust; close the tab to stop sharing.
- Do not page through untrusted content with stored credentials in the same
  webview partition.
- Report security issues by opening a GitHub security advisory on this repository
  rather than a public issue.
