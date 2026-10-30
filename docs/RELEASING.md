# Releasing

## Cut a release

1. Make sure `main` is green: unit tests, backend tests, end-to-end tests ([Testing](TESTING.md#9-automated-tests)).
2. Set the version in `DevBrowser/package.json` (and add a section to `CHANGELOG.md`).
3. Tag and push:
   ```bash
   git tag v1.0.0 && git push origin v1.0.0
   ```
4. The **Release** workflow (`.github/workflows/release.yml`) builds on macOS, Windows and Linux, runs the checks,
   writes `SHA256SUMS.txt` and attaches everything to a GitHub Release.
5. Download the installers on each OS and run the [install checks](TESTING.md#1-install-10-minutes) before you announce it.

## Build locally

```bash
cd DevBrowser
npm ci
npm run dist           # installers for this OS into DevBrowser/release/
npm run dist:mac       # macOS: .dmg and .zip for arm64 and x64
npm run dist:win       # Windows: Setup .exe and Portable .exe (works from a Mac too)
npm run pack           # an unpacked app only (fast), then run it for a quick look
```

Artifacts: `DevBrowser-<version>-mac-arm64.dmg`, `…-mac-x64.dmg`, `DevBrowser-Setup-<version>-x64.exe`,
`DevBrowser-Portable-<version>-x64.exe`, `DevBrowser-<version>-linux-*.AppImage` and `.deb`.

Run the end-to-end suite against an installed build with
`DEVBROWSER_PACKAGED=/path/to/the/executable npx playwright test -c devbrowser.config.ts` (in `e2e/`).

To regenerate the icons after editing `DevBrowser/build/icon.svg`: `npm run icons`.

## Signing (not done for 1.0)

Unsigned installers work but every user sees a warning. To remove it:

- **macOS:** an Apple Developer ID certificate (about $99 a year). Set `CSC_LINK` (the `.p12`) and `CSC_KEY_PASSWORD`,
  remove `"identity": null` from the `mac` section of `package.json`, and add notarization (`APPLE_ID`,
  `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`) with `"notarize": true`.
- **Windows:** a code-signing certificate (an EV certificate removes the SmartScreen warning immediately; a standard one
  earns reputation over time). Set `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD`.
- Put these in the repository's encrypted secrets and pass them to the build step of `release.yml`; remove
  `CSC_IDENTITY_AUTO_DISCOVERY: 'false'`.

## Automatic updates (not done for 1.0)

Add `electron-updater`, a `publish` target (GitHub Releases) in the build configuration, and an update check in the main
process. Updates must be signed, so do this after signing.

## The server

The server ships as source plus a Dockerfile (`backend/Dockerfile`). Version it with the same tag. Do not publish it to
a public network without adding authentication ([Security](SECURITY.md)).
