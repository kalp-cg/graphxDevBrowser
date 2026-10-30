# DevBrowser (desktop app)

The app half of the product. Overview, install and guides are in the [repository README](../README.md) and
[docs/](../docs/).

```bash
npm ci
npm run dev          # run from source with hot reload
npm run typecheck && npm run lint && npm test
npm run build        # production build into dist/ and dist-electron/
npm run pack         # unpacked app for this OS in release/ (fast)
npm run dist         # installers for this OS in release/
npm run icons        # re-render build/icon.png (and sizes) from build/icon.svg
```

Layout:

```
src/main/       main process: window, menu, page sandboxing, network capture, security audit, log, IPC handlers
src/preload/    the typed bridge the interface uses to reach the main process
src/renderer/   the interface (React): new-tab page, tabs, tool panels, service map
src/shared/     types and logic used by both sides (addresses, graph conversion, IPC channel names)
tests/unit/     unit tests (Vitest)
build/          icon source and rendered icons (used by the installers)
```

To run the end-to-end suite against this app, start SentinelGraph's sandbox (`python sandbox/run.py up`) and run
`npx playwright test -c devbrowser.config.ts` in `../e2e`. Add `DEVBROWSER_PACKAGED=<path to an installed build>` to test
an installer's output instead of the source.
