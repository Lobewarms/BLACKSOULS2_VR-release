# BLACK SOULS II VR - modified community fork

[![CI](https://github.com/dimasma0305/BLACKSOULS2_VR-release/actions/workflows/ci.yml/badge.svg)](https://github.com/dimasma0305/BLACKSOULS2_VR-release/actions/workflows/ci.yml)
[![Release](https://github.com/dimasma0305/BLACKSOULS2_VR-release/actions/workflows/release.yml/badge.svg)](https://github.com/dimasma0305/BLACKSOULS2_VR-release/actions/workflows/release.yml)

**Modified fork, not an original Lobewarms release.**
Original: [Lobewarms/BLACKSOULS2_VR-release](https://github.com/Lobewarms/BLACKSOULS2_VR-release).
Upstream base: **2026.10.16-13**. Fork: **0.2.1**.

First-person PCVR for BLACK SOULS II, including Meta Quest through Quest Link,
Air Link or Virtual Desktop. You must supply your own original game. No game files
or saves are included. Free distribution only, under [LICENSE](LICENSE).

## Download and play

**Windows: download [BLACKSOULS_VR_Setup_0.2.1.exe](https://github.com/dimasma0305/BLACKSOULS2_VR-release/releases/download/v0.2.1/BLACKSOULS_VR_Setup_0.2.1.exe).**
Run the setup EXE, then open **BLACK SOULS II VR** from the Start menu. Select your
original game folder and click **Launch**. Desktop play uses keyboard/mouse; for VR,
connect your headset to the PC first, then use **ENTER VR** in the game window.
No ZIP extraction, Node.js or build tools are needed. Setup installs the complete mod
for your Windows user without an administrator prompt, with an optional desktop shortcut.
It still requires your original game and a supported browser. Quest is PCVR, not standalone.

A portable **BLACKSOULS_VR_fork_VERSION.zip** is also available from
[Releases](https://github.com/dimasma0305/BLACKSOULS2_VR-release/releases).
Extract outside your game directory and run `BLACKSOULS_VR/BlacksoulsVR.exe`.
The ZIP includes the Python co-op server, models, third-party licenses and a checksum
manifest. The companion `.sha256` checks the whole ZIP.

See [English setup](docs/upstream/README_en.txt) and
[controls](docs/upstream/CONTROLS_en.txt); Korean, Japanese and Chinese guides are alongside them.
The launcher is an unchanged upstream binary whose source was not supplied. CI verifies
its digest. Its updater may replace fork files with upstream files; use this fork's
Releases for fork updates.

## Structure

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
docs/                          architecture and original multilingual guides
.github/workflows/             CI and release automation
```

See [architecture and runtime compatibility](docs/ARCHITECTURE.md).

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
./tooling/release/build_installer.ps1 -Archive dist/BLACKSOULS_VR_fork_0.2.1.zip -Version 0.2.1
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
git tag v0.2.2
git push origin v0.2.2
```

No personal token secret is needed. Check jobs have read-only repository permissions;
only publishing has `contents: write`. Actions are SHA-pinned; Dependabot checks
npm workspaces, Python build tooling and Actions weekly.

## Upstream and licenses

[Original README](docs/upstream/REPOSITORY_README.md),
[provenance](vendor/launcher/upstream.json), [fork notice](FORK_NOTICE.txt),
and [license](LICENSE). Modified distributions must be free, credit the original and
clearly identify themselves as modified. Never include original game data or saves.
