# Developer notes: BLACK SOULS II VR

## Product requirements

This is a client application for players. Keep the installer, launcher, help,
README and release notes focused on installing, launching, controls, saves and
troubleshooting. Do not put repository structure, libraries, build commands or
CI/CD explanations into player screens or guides. Keep developer documentation
in this AGENTS.md; include it in the installed application for developer access,
without displaying it during setup or linking it from the player menu.
Retain required original-author credits, modification notice and license files.

## Project background

Modified community fork by dimasma0305, based on Lobewarms release 2026.10.16-13.
The upstream Windows launcher source is unavailable; preserve its verified binary
as BlacksoulsVR.Engine.exe. Our source-built BlacksoulsVR.exe detects games first.
Its built-in updater points to upstream and may overwrite fork files. Direct players
to this fork's releases for updates. Do not claim headset playtesting from CI results.

## Structure

`apps/launcher/` is the Windows discovery bootstrap; build it with
`./tooling/release/build_launcher.ps1` before packaging locally. It uses the Windows
.NET Framework compiler and system libraries, with no runtime package downloads.


```text
apps/client/                    npm workspace: Vite browser app
  src/
    core/ data/ game/ world/     runtime, loading, interpreter, map systems
    entities/ combat/ ui/       characters, battles, presentation
    network/ vr/               co-op, headset and controller support
  public/                      runtime configuration and legacy map-editor data
  tests/                       JavaScript regression tests
packages/coop-server/           installable Python package
  src/blacksouls_vr_coop/       runtime and CLI
  tests/                       co-op protocol tests
packaging/                     distribution mappings and portable adapters
vendor/launcher/               upstream executable and provenance only
tooling/release/               release builder and verifier
tests/packaging/               package and portable-entry integration tests
docs/                          original multilingual guides
.github/workflows/             CI and release automation
```

Architecture and runtime compatibility details are below.

## Libraries and build tooling

- **Three.js 0.170.0** is installed through npm, matching the upstream renderer revision.
- **@webxr-input-profiles/assets 1.0.20** supplies the hand models; their bytes match upstream.
- **Vite 8.3.4** resolves imports and bundles the client and dependencies for offline use.
- **ESLint** and **Ruff** lint first-party JavaScript and Python.
- The Python server uses a standard **src-layout package and Hatchling** wheel build.
  Its runtime uses standard-library `asyncio`; no pip dependencies are required to
  run the server from the portable ZIP.

The npm workspace lockfile records exact versions and integrity hashes. Dependency
licenses are emitted into the browser build. Generated files and npm packages are
not committed to source control.

## Develop

Use **Node.js 24** and **Python 3.13** from the repository root:

```sh
npm ci --ignore-scripts
python -m pip install -r requirements-dev.txt
python -m pip install -e ./packages/coop-server
npm run lint
npm test
npm run build
python -m ruff check .
python -m unittest discover -s packages/coop-server/tests -v
python -m unittest discover -s tests/packaging -v
npm run package
```

`npm run build` produces `apps/client/dist/`. `npm run package` also creates the portable
ZIP and checksum in root `dist/`. To build the installable server wheel:

```sh
python -m pip wheel --no-deps --wheel-dir dist ./packages/coop-server
python -m blacksouls_vr_coop --help
```

`npm run dev` starts Vite on localhost. The frontend still needs the original launcher's
backend for `/api`, `/game` and `/rtp`. Start the launcher with your game folder and set
`BLACKSOULS_VR_BACKEND` to that local backend URL before starting Vite. Vite forwards
those paths to it. The co-op relay is separate from the game-data backend.

Tests use synthetic game data, in-memory protocol streams and an isolated portable
Python launch. No game files or headset are needed for CI. Successful CI does not
replace a PCVR playtest; headset rendering and full story-event compatibility remain
manual checks.

## Build the Windows installer

Install Inno Setup 6 on Windows, then after `npm run package`:

```powershell
./tooling/release/build_installer.ps1 -Archive dist/BLACKSOULS_VR_fork_0.2.2.zip -Version 0.2.2
```

The installer bundles the verified portable distribution and creates Start menu
shortcuts. Its default writable location is `%LOCALAPPDATA%\Programs\BLACKSOULS-VR`.
Player-created saves are retained during upgrades and uninstall. The setup EXE is
currently unsigned. Python is only needed by players who host the optional co-op relay.

## CI/CD

Pushes to `main` and pull requests run lint, tests, the Vite production build, portable
package tests and Python wheel creation on **Windows and Linux**. Each run provides
ZIP, checksum and wheel artifacts, retained for 14 days. Windows additionally builds
an Inno Setup EXE and verifies installation against the file manifest, upgrade,
uninstall and retention of player-created saves.

A `v*` tag runs the same checks. After success, publishing downloads the tested
Linux artifact, checks its version and checksum, and promotes it to a GitHub Release.
It also promotes the tested Windows setup EXE and its checksum. It does not rebuild
the client. Existing releases are never overwritten.

For the next release, update the root and client `package.json`, the server's
`pyproject.toml` and `__init__.py`, then run `npm install --package-lock-only` and commit.
After green CI, push the matching tag, for example:

```sh
git tag v0.2.3
git push origin v0.2.3
```

No personal token secret is needed. Check jobs have read-only repository permissions;
only publishing has `contents: write`. Actions are SHA-pinned; Dependabot checks
npm workspaces, Python build tooling and Actions weekly.


## Architecture details

This is a modified fork of Lobewarms' BLACK SOULS II VR mod.

## Client

`apps/client` is an npm workspace. Vite resolves browser modules, bundles the
application and Three.js, and emits runtime model files and dependency licenses.
No CDN or runtime npm installation is needed by players.

Source groups under `apps/client/src/`:

- `core/`: boot, shared runtime context, input
- `data/`: asset/database loading, Ruby Marshal reader, extracted game scripts
- `game/`: state, Ruby-expression adapter, event interpreter and interaction
- `world/`: maps, collision, geometry, tiles, sky and markers
- `entities/`: player and character behavior, sprites, allies and poses
- `combat/`: battle logic, boss moves, weapons and effects
- `ui/`: HUD, inventory slots, localization, pictures, sound and presentation
- `network/`: co-op state, transport and validation
- `vr/`: headset/controller integration, hand models and spectator view

The migration updates relative imports while preserving gameplay behavior. Existing
systems still share the upstream `G` context; directory separation is not a claim
that all engine systems have been decoupled.

`public/` holds files whose runtime URLs are part of the launcher's contract.
In particular, `src/maphints.user.json` stays at that URL for compatibility with
the upstream map editor. It is editable data, not an unbundled source module.

## Server

`packages/coop-server` is a standard Python `src/`-layout package with a pinned
Hatchling build backend, wheel metadata, console command and package-local tests.
Its runtime uses standard-library asyncio, retaining the existing co-op protocol
and requiring no third-party runtime installation in portable releases.

The installed CLI is `blacksouls-vr-coop`; the module entry point is
`python -m blacksouls_vr_coop`. Config defaults to the current working directory,
or the `BLACKSOULS_VR_COOP_CONFIG` path when set. The portable adapter sets that
path next to `coop_server.py`, preserving the old release behavior.

## Packaging

`vendor/launcher/` contains the upstream-only executable and provenance record.
The launcher source was not provided; it is verified, not recompiled.

`packaging/distribution.json` maps repository inputs to the launcher's runtime tree.
Only declared files, Vite's build output and the server package sources enter the
portable ZIP. Tooling validates paths, source boundaries, launcher digest and
licenses. Generated outputs stay ignored under `dist/` and `apps/client/dist/`.

```text
BLACKSOULS_VR/                  generated release layout
  BlacksoulsVR.exe
  coop_server.py                compatibility adapter
  coop_server.cmd
  server/blacksouls_vr_coop/    portable Python package
  app/
    index.html
    assets/                    bundled client and Three.js
    models/hands/              npm WebXR assets
    licenses/                  third-party licenses
    devserver.json
    version.txt
    src/maphints.user.json      legacy map-editor URL
```

CI builds and tests on Windows and Linux. Tag releases promote the already-tested
Linux artifact to GitHub Releases, together with its checksum and installable Python
wheel. The publish job does not rebuild the browser application.

## Windows setup

`packaging/windows/setup.iss` uses Inno Setup 6 to install the verified portable
payload per user. `tooling/release/build_installer.ps1` verifies the input ZIP,
compiles the installer and writes its SHA-256. Windows CI silently installs it,
compares every installed file with the distribution manifest, checks upgrade and
uninstall, and confirms player-created saves survive both. The release job promotes
that tested EXE unchanged alongside the portable ZIP. It contains all mod files,
not the original game or a bundled browser. The upstream launcher remains unchanged.

## Unused metadata cleanup

The root version.json was stale upstream release metadata, unreferenced by this
fork and excluded from distribution. It has been removed. The manifest already
records the fork version, so FORK_VERSION.txt is no longer generated. The old
packaged FORK_README.md duplicated the player guides and is no longer shipped.
Setup removes those two superseded documents on upgrade. START_HERE.txt is the
player entry point; this AGENTS.md carries development notes. Keep upstream.json:
it supplies the launcher's integrity check. Preserve app/version.txt until the
upstream launcher contract is independently checked; devserver.json and map hints
are consumed by the client. Original multilingual documentation is retained.

Update versions through parsed fields in package-lock.json; never do a global
substring replacement, which can also alter dependency versions and URLs.

## Automatic game discovery

The native bootstrap checks the saved launcher.json gameDir first without editing
other settings, then scans common user/game directories and Steam libraryfolders.vdf.
A candidate must have Game.exe plus extracted System.rvdata2 or a version-3 RGSS
archive header, and its folder name or Game.ini title must identify BLACK SOULS II.
A folder explicitly selected by the user only needs valid game-data markers.
The scanner skips reparse points and inaccessible directories, bounds recursion,
directory count and elapsed time, and supports cancellation. A single copy is
prefilled automatically; multiple copies require selection; Browse is the fallback.
There is no universal BLACK SOULS II install directory; do not promise whole-disk detection.

The original launcher receives --game via a correctly quoted process argument and
retains game validation, localization, VR options, server, saves and browser launch.
The native bootstrap exits after handing off. Config remains at the original
launcher location; the original launcher persists the selection when Launch is used.
All original CLI diagnostics pass through. The upstream binary is unchanged and
retains its recorded digest, under a different filename beside the bootstrap.

CI builds and tests the Windows bootstrap once, then downloads the identical
artifact into both packaging jobs. It does not commit generated executables.
The existing package verifier validates the stock engine digest and the manifest
checksums for the bootstrap. Original pre-bootstrap releases remain verifiable.
Tests cover real Windows process argument round trips, Unicode, wrong game titles,
extracted/packed candidates, multiple copies, nested roots, Steam libraries, limits,
cancellation and preserving settings. No original game is used or executed by tests.

## Runtime bug fixes (0.2.3)

- Input: blur previously cleared keyboard state only. Mouse buttons, prior button
  edges, accumulated look movement and wheel could remain latched without mouseup.
  Blur now clears desktop input; pointer unlock releases the mouse while retaining
  Escape so the same press can still cancel a menu. Tests reproduce both sequences.
- Assets: failed image/canvas promises were cached forever. Successful and pending
  requests are still shared, but null/rejected results evict their exact cache entry
  so later requests can retry. Tests fail once then succeed, including canvas loads.
- Marshal: plain strings were UTF-8 decoded before their following encoding ivars.
  Shift-JIS bytes C2 A9 were therefore irreversibly turned into copyright-sign text.
  Wrapped strings now retain bytes until encoding is known; object links get the
  final decoded value. Tests preserve UTF-8 and binary behavior too.
- Saves: HTTP/listing failures could become an empty list, bypassing overwrite
  confirmation. Manual saving now requires a successfully parsed slot inventory.
  Save transport validates response status, slot entries and core saved-state shape;
  legacy missing metadata becomes an empty metadata object without losing the slot.
  Failed loads toast and return null; callers retain menus and never enter that
  state. Manual writes toast on network failure as well as HTTP failure. New player
  messages are translated in all four supported UI languages.

The runtime tests use synthetic data and simulated browser events/network replies.
The save compatibility test round-trips the actual GameState serializer/parser.
Input, image-cache and text-encoding tests were run against the unmodified code and
failed before their fixes. No original game or headset playtest was available.
