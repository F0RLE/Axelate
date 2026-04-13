# Launchers

Double-click launchers live here to keep the repository root clean.

Current launcher set:
- `dev.*` is the kept development launcher and starts the inspect-enabled desktop dev flow.
- `build.*` builds the project.
- `clear.*` removes build artifacts and caches.
- `verify.*` runs the full repository verification gate.

Windows:
- `windows/dev.cmd`
- `windows/build.cmd`
- `windows/clear.cmd`
- `windows/verify.cmd`

macOS:
- `macos/dev.command`
- `macos/build.command`
- `macos/clear.command`
- `macos/verify.command`

Linux:
- `linux/dev.sh`
- `linux/build.sh`
- `linux/clear.sh`
- `linux/verify.sh`

CLI remains the same from the repository root:

```bash
npm run dev
npm run build
npm run clear
npm run verify
```
