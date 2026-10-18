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

Modified community fork by dimasma0305, based on Lobewarms release 2026.10.18-1.
The upstream Windows launcher source is unavailable; preserve its verified binary
as BlacksoulsVR.Engine.exe. Our source-built BlacksoulsVR.exe detects games first, hosts the original launcher
form and supplies the fork updater described below. The legacy upstream checker is
disabled before the original form is constructed. Do not claim headset playtesting from CI results.

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

The original launcher receives --game through its Options parser and
retains game validation, localization, VR options, server, saves and browser launch.
The source launcher hosts that form in the same process. Config remains at the original
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

## Corpse rendering and initial choice highlight (0.2.4)

User reports: corpses drawn upright and dialogue choices not highlighting the
first answer. CharacterSprite.isCorpseGraphic already recognized Japanese corpse,
DamageN and stationary-skeleton sheets, but layMode used blocking priority to
stand them up. Recognized event corpse graphics now choose lie before wall,
priority and acting overrides, leaving collision properties untouched. Added
bounded English corpse/cadaver/dead-body graphic names without matching Undead
characters. Walking skeletons, living actors and doors keep their existing modes.

The user's first-choice preference overrides the old intentional misselection
prevention script port. Local and remote dialogue choice panels open at index 0.
The frame opening choices still returns before processing confirmation, so opening
and choosing remain distinct actions. Disabled choices retain their enabled flag.
Explicit unselected lists (index -1) are still supported by ListPanel when needed.

Tests construct real Three.js meshes and UI panels using synthetic canvases. They
assert horizontal geometry/upward normals, stable frame selection across viewer
positions, revival back to an upright graphic, unchanged collision properties,
first-row focus, no opening-frame answer and disabled-answer behavior. These tests
failed against the prior runtime and pass after the fixes. No original game images
or headset rendering are involved, so manual in-game visual verification remains.

## Desktop swing and archived pistol icons (0.2.5)

Desktop melee formerly rotated the hand in place and dipped the blade below the
screen. desktop-weapon.js now provides camera-space wind-up, sweep, follow-through
and recovery, with exact matching endpoints. The duration and active hit window
remain unchanged. Equipment/mode changes cancel the prior desktop animation.
Ranged weapons keep an aiming pose. visualLength separates scaled desktop barrel
positions from the unchanged gameplay weapon length.

The user's Hunter-class pistol issue was verified in their installed game: loose
Graphics/System/IconSet.png is 384x936 (624 icons), while Silver Pistol armor 65
requests icon 706. Game.rgss3a contains the complete 384x1300 sheet. The upstream
engine prioritizes loose files, so iconPixels returned null and a generic model
was used. Do not patch the original game or distribute its art.

GameAssetCache.cs extracts only the archived IconSet entry, with bounded entry
sizes and validated offsets, when its complete rows exceed the loose sheet's.
The cache is written atomically under the installed mod's app/local-assets directory.
Its metadata binds it to the selected game. The browser compares /api/ping.game
before using it; complete low-numbered loose icons retain priority. The inventory
and held models both select the appropriate sheet per icon. Asset revision changes
invalidate equipment built before icons were ready. The original engine binary
remains unchanged. Close/reopen the launcher after updating; direct launches of
the engine bypass first-time cache preparation.

Automated tests use synthetic RGSS3A archives/PNGs, verify source files stay intact,
validate cache invalidation, overflow/truncation handling, matching-game guards,
icon-based held pistol meshes and inventory art, correct desktop muzzle length,
and a blade path crossing the screen with an exact return to rest. A private
read-only verification against the user's actual archive confirmed identical
recovered pixels. Private inspection files stay outside this repository under
workspace .tools or the system temp directory, and never enter release packages.
No game/headset playtest or new 3D model assets are claimed.


## Furniture perspective (0.2.6)

Furniture previously shared the character billboard path, so chairs, cabinets
and bookcases could turn toward the camera. The low-block list also missed
Inside_B single/damaged beds and several tables. Tile events never consulted
that list and could stand a known bed upright because of its priority/flags.

furniture.js provides explicit sheet/index profiles verified against the user's
installed art. VXTileD and RoyalTileset-TileB chair views resolve to matching
front/rear drawings and fixed map directions; Inside_B/VXTileD stools have their
own profiles. Existing voxel geometry folds the art into horizontal seats,
upright backrests and front/rear legs, retaining pixel edges and rear artwork.
Transparent bottom margins are removed from leg spans so feet touch the floor.
No game art is committed or packaged. Repeated map seating uses InstancedMesh
per tile, with explicit instance-buffer disposal for maps and loop copies.

furnitureFloor creates a rendering grid over the original lower floor layers;
it never alters the gameplay grid, event priority or through state. Objects on
impassable bases retain the existing wall/side-view rendering. The known upright
cupboard/bookcase/piano/crate pieces use fixed boxes in map and tile-event paths.
Known flat event furniture uses a low horizontal block. Doors, living actors,
unknown art and special side-wall placement keep their existing rules. Tile-event
arrangement keys now include mode, priority and through state for page changes.

Validation: 33 JavaScript tests include real Three.js furniture geometry, shape
normals, directions, unchanged collision, transparent foot margins, event page
changes, fixed storage, full map build and instance disposal, with synthetic art.
Private read-only inspection covered the installed tileset images and all 410
map records: 234 eligible chair/stool placements across 22 maps, plus one matching
event page. All 28 art profiles generated geometry with feet on y=0. A private
perspective preview checked six representative models from front, rear and side
at player eye height. These are geometry previews and data checks; no full-game
or headset playtest is claimed. Private art and map files remain outside the
repository under workspace .tools and must never enter release artifacts.


## Loose books and desk support (0.2.7)

The user identified books standing upright in the dream room. Installed Map101
is named Library Dream and uses four loose Inside_C book/paper tiles (315, 318,
319, 330). Their blocking flags sent them through the upright standee path.

Explicit Inside_C 56-80 and VXTileD 204-205 loose-book/paper profiles now create
thin horizontal pixel geometry: covers 1.5 px thick, open books 1 px, papers
0.2 px (32 px per tile). These profiles are distinct from bed-height flat blocks,
bookcases and the animated 本/浮遊本 character sheets. Do not use a broad book-name
regex; the installed game also uses floating books as animated event characters.

furnitureFloor examines a grid exposing only the lower layers. A book on a desk
is extracted even when that desk is impassable; the desk's passage/counter flags
and geometry stay intact. Map instances rest at the support's solidTop, otherwise
at floorAt. Tile-event books request lying placement from spotOnSolid so they
land on the supporting tabletop. Rendering never changes the gameplay grid,
reading event priority or through state. Impassable wall bases keep their existing
rendering; the loose-floor/desk rule does not flatten bookshelf/architectural art.

Private read-only map inspection found 35 eligible placements across five maps,
including 11 on tabletops and all four in Library Dream. Those four generated
horizontal original-art geometry with thickness between 0.0094 and 0.0704 metres.
Private eye-height geometry previews checked covers, open books and papers from
front and rear. No original art or map records are committed or distributed.
Book regression checks cover thin horizontal
geometry, floor/table support, retained desks, no duplicate upright books and
unchanged interaction/animated-character rules. Full game/headset playtesting
remains separate from these geometry and data checks.


## Retrieval beacon, remains, destination names and soul items (0.2.7)

The user's translation clarification applies specifically to the teleport-circle
labels, not the launcher. MapInfos editor names stay available for existing uses.
loadMapNames preloads destination display_name values from the installed game,
retaining a small text cache independently of full-map eviction. destinationName
uses that title or the nearest named parent; failures/cycles fall back to localized
Area {id} in ko/en/ja/zh. buildMapView resolves exit labels before constructing
markers. This uses the installed game's translated names, not machine translation
of game dialogue or a shipped map-name database. The dream library's exits include
Dungeon and Room of Reminiscence; unnamed rooms use their parent/fallback.

The original retrieval event is event 1 calling common event 32, using !Flame
slot 5 with below-player priority. CharacterSprite now checks isSoulEvent before
priority-based layMode, preserving the upright animated beacon without changing
its retrieval logic. Corpse top quads are raised by 0.18 m (0.12 m for recognized
skeletal corpse graphics) and gain pixel-shaped side geometry from the selected
sheet frame. The side mesh is rebuilt only when the actual frame changes and is
disposed on graphic/page changes and map removal. Slot 0 of 死体・血・サイン is bodies;
the blood/sign slots keep their decal treatment. Existing living/walking-character
rules remain. Explicit floor-bone tile profiles cover Dungeon_B 240-242/248-250,
Outside_C 24-25 and VXTileE 28 with 3.5 px thickness. Outside_C aliases were verified
pixel-identical to the reviewed bone art. Read-only inspection found 322 eligible
floor-remains placements across 23 installed maps.

Black Soul (item 17 / common event 221) and Tainted Black Soul (79 / 222) are
intentionally consumable=false in the original database: their event handles
quantity, confirmation, item removal, permanent parameter increases and SEN cost.
The Ruby adapter lacked item_container queries and could not compile literal
for i in 2..7 loops, so the entire removal/stat script failed. Added read-only
item-container count access and translation of literal inclusive/exclusive integer
for ranges. Preserve the database flag; forcing consumable=true would spend items
before confirmation or twice. Actual single/batch scripts for both items were
run privately against isolated inventory/actor state; all four removed the right
quantity and applied HP, MP and parameters. No original game state/save was changed.

45 client tests now pass. New checks cover range boundaries, item counts, use via
the real CombatSystem/Interpreter with confirm/cancel, stat/SEN changes, upright
retrieval beacons, corpse-side height/lifecycle, bone orientation, localized exit
names, missing/cyclic-parent fallback and all four fallback languages. These tests
and private artwork/data inspections do not constitute a full game/VR playtest.

## Upstream merge and release updates (0.2.8)

Merged upstream d39c2af (2026.10.18-1), preserving the source layout and community
fixes. Imported the scriptdata parser and travel visibility/availability rules,
plus the verified engine and original guides. Removed the root release ZIP and
stale version.json introduced by that merge. Upstream ancestry is recorded.

Translated script section names previously prevented bonfire tables from loading.
The parser now falls back to script content, accepts both Ruby quote styles and
spacing/defaults, and honors visibility, selection and erase switches. Synthetic
regressions cover parsing and actual menu/transfer wiring.

The original updater hardcodes Lobewarms, a date-version parser and an upstream-only
URL allowlist. Passing --update-url cannot support fork SemVer. EngineHost.cs loads
the verified engine assembly, temporarily sets its screenshot sentinel before
constructing LauncherForm (skips CheckUpdateAsync), clears UpdateUrl, asserts that
UpdateCheck stayed null, then restores Screenshot before the form is shown. It
hides the old button and installs the source-controlled update button and localized
status/progress text. The fork version/title survive language changes. The new
engine resolves app/ from the entry assembly location. Tests instantiate the actual
vendor form in a fresh temporary installation. The binary remains unchanged.

package_release.py generates release.json inside the distribution, using
GITHUB_REPOSITORY from Actions (or the local origin remote) and package.json's
version. No owner, fork version or upstream URL is pinned in updater code. This
file is consumed at runtime, unlike the removed upstream root version.json. The
Windows setup URLs are supplied from the same verified identity. Keep the app's
release.json beside its executable. Tag releases still promote the tested
installer and ZIP after the existing checks pass.

The updater uses GitHub's latest stable release API, numeric SemVer comparison,
matching versioned setup/checksum assets from that repository, bounded installer
size, exact byte count and SHA-256 before offering setup. Partial/failed downloads
are removed, and unavailable updates never block playing. Setup targets the current
installation directory and preserves saves using the existing installer contract.
Players confirm closing the game before opening setup. Downloads are staged in
the user's temporary directory. No API token or runtime package manager is needed.
Diagnostic selftests pass through to the stock engine. --screenshot uses the hosted
form without an online update check, so review images show the real fork UI.

Native update tests cover version comparison, preview/downgrade behavior, fork URL
selection, missing checksums, download/verification failures and real engine hosting.
Packaging tests build under an alternate GITHUB_REPOSITORY to prevent accidentally
pinning future forks to this owner. No automated result claims a headset playtest.

## Save location language (0.2.9)

VR save metadata formerly used mapName(), which reads RPG Maker editor labels
from MapInfos. The user's existing saves had Japanese editor labels even though
the corresponding game maps had English display_name values. Save/load/overwrite,
title Continue and co-op save lists echoed those stored labels indefinitely.

savepresentation.js preloads names for slot map IDs and resolves player-facing
titles through the existing destinationName/translated parent fallback. The
current map's parent chain is also loaded during map-view preparation, so new
save metadata can use that name synchronously without adding any await between
the state snapshot and POST serialization. Existing save metadata is only read,
never migrated or rewritten by listing. Old saves without map IDs retain their
original label. A title lookup failure uses the localized Area ID fallback and
does not imply an empty save slot. New metadata date strings use fmtDate() rather
than the browser default locale; numeric timestamps remain compatible.

Tests cover stale editor labels, unnamed-room parent titles, duplicate slots,
read failures, unchanged saved metadata and the actual co-op menu wiring. Save
menu/notification translations are checked in all four supported languages with
a Chinese browser locale. Original game data and player save files remain private
and are never included in repository fixtures. No headset playtest is claimed.
