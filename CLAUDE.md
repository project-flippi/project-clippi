# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Project Clippi is a Super Smash Bros. Melee automation framework built with **Electron 7 + React 16 + TypeScript**. It detects in-game events in real-time and executes actions (OBS recording, Twitch clips, sounds, etc.). It also processes SLP replay files for sorting/renaming.

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
  - `obs.ts` — OBS WebSocket integration (obs-websocket-js)
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

## Webpack Customization

Custom renderer webpack config in `webpack.renderer.additions.js`:

- Web worker support via comlink-loader
- Global variables: `__VERSION__`, `__DATE__`, `__BUILD__`
- Platform-specific externals (fsevents on macOS only)
