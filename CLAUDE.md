# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Project Clippi is a Super Smash Bros. Melee automation framework built with **Electron 7 + React 16 + TypeScript 5.1**. It detects in-game events in real-time and executes actions (OBS recording, Twitch clips, sounds, etc.). It also processes SLP replay files for sorting/renaming.

## Common Commands

```bash
yarn start          # Dev server with HMR (both main & renderer)
yarn build          # Production build via electron-webpack
yarn dist           # Create distributable binary
yarn test           # Jest tests (verbose, 120s timeout)
yarn typecheck      # TypeScript type checking only
yarn lint           # ESLint
yarn lint:fix       # ESLint with auto-fix
```

Platform-specific builds: `yarn dist:win`, `yarn dist:mac`, `yarn dist:linux`

## Architecture

### Electron Multi-Process Structure

- **`src/main/`** — Electron main process: window creation, IPC setup, system-level operations (Twitch auth, file dialogs, notifications, auto-update)
- **`src/renderer/`** — React UI: event configuration, replay processing, settings
- **`src/common/`** — Shared types, IPC class (`ipc.ts`), constants, theme definitions

### Renderer Organization

- **`store/models/`** — Rematch (Redux wrapper) models: `automator`, `slippi`, `filesystem`, `tempContainer` (non-persistent real-time state), `twitch`, etc.
- **`lib/`** — Core business logic:
  - `automator_manager/` — Event detection and action execution pipeline
  - `realtime.ts` — Slippi console/Dolphin connection and event streaming via RxJS
  - `liveContext.ts` — Tracks game context (combos, conversions) for action variables
  - `obs.ts` — OBS WebSocket v5 integration (obs-websocket-js ^5.x, requires OBS 28+)
  - `dolphin.ts` — Dolphin recording automation
  - `connectionStatusWriter.ts` — Writes connection status files for Flippi integration
  - `event_actions/` — Action execution system
- **`components/`** — Pure UI components (no Redux)
- **`containers/`** — Redux-connected smart components
- **`views/`** — Page-level containers (AutomatorView, RecorderView, ReplayProcessorView, settings pages)
- **`workers/`** — Web workers via comlink (fileProcessor.worker.ts for async SLP parsing)

### Key Patterns

- **IPC**: Typed `IPC` class in `src/common/ipc.ts` with `Message` enum. Main process listeners in `src/main/listeners.ts`.
- **State**: Rematch models with `@rematch/persist` for localStorage. `tempContainer` model holds transient real-time state.
- **Real-time events**: `@vinceau/slp-realtime` + RxJS observables for game event streaming. `EventManager` converts Slippi events to action triggers.
- **Store subscriptions** in `src/renderer/store/index.ts` sync state changes to realtime config, sound files, combo profiles, etc.

### TypeScript Path Aliases

- `@/*` → `src/renderer/*`
- `common/*` → `src/common/*`

## Code Style

- **Double quotes**, not single quotes (Prettier enforced)
- Print width: 120 characters, trailing commas (es5)
- **Named exports only** — no default exports (ESLint rule)
- **Explicit member accessibility** on classes
- TypeScript strict mode with all strict flags enabled
- Pre-commit hook runs pretty-quick via Husky

## Environment Variables

- `ELECTRON_WEBPACK_APP_TWITCH_CLIENT_ID` — Required for Twitch integration
- Twitch redirect URI: `http://localhost:3000/auth/twitch/callback`

## Build Tooling

- **electron-builder 23.6.0** (pinned to avoid 24.x which requires electron-updater 5.x). Handles Python 3 natively for macOS DMG creation.
- **electron-updater ^4.6.5** — same API surface as 4.3.x (`checkForUpdates()`, `downloadUpdate()`, `quitAndInstall()`, `autoDownload`, `error`/`update-downloaded` events).
- **obs-websocket-js ^5.x** — OBS WebSocket v5 protocol (built into OBS 28+). Default port is `4455`. Uses `socket.call()` (not `send()`), camelCase params, and consolidated `RecordStateChanged` event with transitional states (e.g. `OBS_WEBSOCKET_OUTPUT_STARTING` before `OBS_WEBSOCKET_OUTPUT_STARTED`). Filename formatting uses `SetProfileParameter`/`GetProfileParameter` instead of removed `SetFilenameFormatting`/`GetFilenameFormatting`.
- **Patches** (applied automatically via `patch-package` postinstall):
  - `twitch-electron-auth-provider+4.0.10.patch`
  - `fork-ts-checker-webpack-plugin+4.1.6.patch` — wraps `Object.assign` in try/catch to fix TS 5.x compatibility

## Git Remotes

- **`origin`** → `project-flippi/project-clippi` (fork) — all pushes go here.
- **`upstream`** → `vinceau/project-clippi` (upstream) — read-only, no push access.
- Always use `git push origin <branch>` (never bare `git push`).

## CI/CD

- **Build workflow** (`.github/workflows/build.yml`): Runs on push to all branches. Tests, lints, and builds on Ubuntu, Windows, and macOS. Tests/lint only run on Ubuntu.
- **Release workflow** (`.github/workflows/release.yml`): Triggered by `v*` tags. Builds on all three platforms and creates a GitHub release via `softprops/action-gh-release@v2`.
- **Node 16.x** in CI (not the local dev version — local dev is unaffected).
- **Electron 7.3.3 has no ARM64 macOS binary.** CI sets `npm_config_arch=x64` and passes `--x64` to electron-builder to force x64 builds on ARM64 macOS runners.

## Webpack Customization

Custom renderer webpack config in `webpack.renderer.additions.js`:

- Web worker support via comlink-loader
- Global variables: `__VERSION__`, `__DATE__`, `__BUILD__`
- Platform-specific externals (fsevents on macOS only)
