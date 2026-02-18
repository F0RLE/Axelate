# Automation & Build Scripts

Axelate uses a robust set of **PowerShell Core** scripts to manage the development lifecycle. These scripts are cross-platform (Windows/Linux/macOS) and enforce strict environment checks to ensure consistency.

## 🚀 Quick Reference

| Command | Action | Scripts Used |
| :--- | :--- | :--- |
| `npm run dev` | **Start Dev Server**<br>Formats code -> Checks Environment -> Starts App | `dev.ps1` |
| `npm run verify-all` | **Release Gate**<br>Full audit: Format + Lint + Typecheck + Test + Build Check | `verify-all.ps1` |
| `npm run build` | **Production Build**<br>Compiles frontend + backend | `src/package.json` |
| `npm run release` | **Release Flow**<br>Runs `verify-all` -> Builds Release Binary -> Opens Folder | `release.ps1` |
| `npm run check-size` | **Audit Size**<br>Reports the `dist/` folder size | `check-size.js` |
| `npm run clean` | **Deep Clean**<br>Removes `target/`, `dist/`, cache | `clear.ps1` |

---

## 🛠️ The Scripts

All core scripts are located in `.github/scripts/`. They are written in PowerShell 7+ syntax but run on standard Windows PowerShell 5.1 via the `pwsh` polyfills we implemented.

### 1. Development Loop (`dev.ps1`)
**Usage:** `npm run dev`

This is your daily driver. It does more than just start the app:
1. **Auto-Format:** Runs `prettier` on all source files.
2. **Environment Check:** Verifies `cargo`, `node`, and `npm` are in PATH.
3. **Execution:** Launches `tauri dev` with safe arguments.

> **Note:** If auto-formatting fails (e.g., syntax error), the script will warn you but attempt to proceed, preventing a hard crash during active debugging.

### 2. The Release Gate (`verify-all.ps1`)
**Usage:** `npm run verify-all`

**MUST PASS** before any Pull Request or Release. It enforces zero-tolerance policy:
1. **Frontend Checks:**
   - `npm run format:check` (Prettier)
   - `npm run lint` (ESLint)
   - `npm run typecheck` (TSC)
   - `npm run check-size` (Bundle budget)
2. **Backend Checks:**
   - `cargo fmt -- --check` (Rustfmt)
   - `cargo clippy` (Lints)
   - `cargo test` (Unit tests)

If *any* step fails, the script exits immediately with an error code.

### 3. Release Builder (`release.ps1`)
**Usage:** `npm run release`

Automates the production build:
1. Runs `verify-all` (aborts if failed).
2. Runs `npm run tauri:build` with production flags.
3. Opens the output folder containing the `.exe` / `.msi`.

### 4. Size Auditor (`src/scripts/check-size.js`)
**Usage:** `npm run check-size`

A Node.js script that calculates the recursive size of the `dist/` folder (frontend bundle). It ensures we don't accidentally ship massive assets.

---

## 🔒 Security & Robustness

We strictly adhere to the **Robust PowerShell Pattern**:

1. **Strict Mode:** `Set-StrictMode -Version Latest` catch uninitialized variables.
2. **Error Handling:** `$ErrorActionPreference = 'Stop'` ensures no silent failures.
3. **Environment Isolation:** `Initialize-Environment` explicitly checks for tools (`rc.exe`, `cargo`) before running.
4. **Path Safety:** All paths are resolved relative to `$PSScriptRoot`.
5. **Cross-Platform:** `npm` vs `npm.cmd` is detected dynamically.

## 📦 CI/CD Integration

GitHub Actions workflows should use `verify-all.ps1` as the single source of truth for CI checks.

```yaml
- name: Verify Codebase
  run: npm run verify-all
  shell: powershell
```
