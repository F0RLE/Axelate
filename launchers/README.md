# Launchers

Double-click launchers live here to keep the repository root clean.

Development launchers:
- `dev-app.*` starts the desktop app in the Tauri WebView runtime.
- `dev-inspect.*` starts the desktop app with DevTools and WebView remote debugging on port `9223`.
- `dev-release-like.*` starts the desktop app from the built static frontend bundle.
- `dev.*` is the default desktop development entry point.

Windows:
- `windows/dev.cmd`
- `windows/dev-app.cmd`
- `windows/dev-inspect.cmd`
- `windows/dev-release-like.cmd`
- `windows/build.cmd`
- `windows/test.cmd`
- `windows/verify.cmd`

macOS:
- `macos/dev.command`
- `macos/dev-app.command`
- `macos/dev-inspect.command`
- `macos/dev-release-like.command`
- `macos/build.command`
- `macos/test.command`
- `macos/verify.command`

Linux:
- `linux/dev.sh`
- `linux/dev-app.sh`
- `linux/dev-inspect.sh`
- `linux/dev-release-like.sh`
- `linux/build.sh`
- `linux/test.sh`
- `linux/verify.sh`

CLI remains the same from the repository root:

```bash
npm run dev
npm run dev:webview
npm run dev:inspect
npm run dev:release-like
npm run build
npm run test
npm run verify
```
