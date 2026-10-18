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

## Combat status and enemy names (0.2.10)

Enemy bars previously rendered only HP and groggy to a 128x22 canvas, so there
was no enemy name or state renderer. Player HUD states were icon-only, omitted
iconless effects and did not invalidate when icon assets loaded. The new shared
battler-status.js builds named states (priority order) plus parameter buffs and
debuffs from the game database; missing artwork never removes the text label.

The player HUD is larger, readable on its existing desktop/wrist anchors and does
not depth-test against weapons or terrain. It shows four effects per page, cycles
overflow every four seconds and points to the full Status menu list. Enemy bars
are now 512x184 nameplates with names, the same HP/groggy values and four effect
labels per page, cycling every three seconds. Text fits its allotted area. Both
render caches include status identity, page and icon asset revision; otherwise
textures are reused. Rebuilding an enemy clears the cache; removal disposes its
nameplate texture/material. Existing combat values and status lifetimes are not
changed. Labels hide for defeated, hidden or untargetable enemies and beyond 18m;
normal world depth testing keeps them behind walls.

Co-op snapshots carry optional top-level buffs metadata for normal and private
enemies. The original 15-field normal / 17-field hallucination tuples stay intact,
so older clients can ignore the extension and newer clients accept legacy hosts.
Only eight integer levels in -2..2 are accepted. It is display metadata and does
not change authoritative combat stats or guest hit reporting. Empty snapshots
clear the indicators; host state IDs already use the existing transport.

Regression tests use actual Three.js meshes, canvases with synthetic data and real
BattlerBase state/buff methods. They cover missing icons, removal/expiry, all effect
pages, menu overflow, late-asset invalidation, desktop/wrist anchors, name visibility,
distance/hidden/death rules, disposal and co-op send/receive compatibility. A local
browser preview checked the real UI canvases/3D nameplates for desktop and a
simulated controller anchor using synthetic art. This is not a headset playtest.
Temporary preview HTML and game assets must never enter the packaged app.


## Navigation, menu usability and game artwork (0.2.11)

User requirement: reuse the installed game's original assets whenever suitable,
including status icons, tiles, fonts and window skin, before inventing replacement
art. Never commit or distribute those original assets. Keep readable fallbacks
when an asset is absent and simple navigation marks where no game asset exists.

NavigationMap renders a north-up local map and current-area overview from MapGrid,
the current map-view analysis and its already-loaded TileDrawer. The artwork raster
is capped at 2048 pixels per side and built once per grid/analysis/drawer identity;
the live position and head facing refresh at 10 Hz without rebuilding terrain.
Non-loop windows clamp; looping windows wrap continuous tile-centre coordinates
and draw adjacent copies. Exit cells share numbered destination legends; all
legend entries remain reachable with arrows/stick or pointer buttons. Destination
labels use translated display_name, never map editor names. Transfers discard
old analysis; no tile, save, event or combat state is mutated by drawing. This is
an area overview, not a route planner or guarantee of passage through event doors.

PC N and Menu > Map open the overview. VR uses the menu and a left-controller
minimap anchor above the existing HP panel. The minimap hides behind menus,
messages, transfers, death and title; its display option persists with settings.
Full-map Back works with cancel, N/menu, mouse or VR pointer. Main menu is one
page with Character, Save / Load and Settings groups; returning restores the
parent selection. Return to title has an in-app confirmation starting on Cancel.

Window.png uses the VX Ace 128x128 background/frame/cursor layout. Eight frame
slices exclude the central scroll-arrow artwork; cursor rendering includes its
centre. All window art comes from loadUiAssets, and missing art keeps the existing
fallback. Format coordinates were checked against the primary mkxp WindowVX
implementation (https://github.com/Ancurio/mkxp/blob/master/src/windowvx.cpp).
Status icons use the database icon_index (buff icons retain VX Ace indices),
prefer the installed game's primary sheet and only use matching-game archived
cells for icons beyond a short loose sheet. No substitute status artwork is made.

Mouse selection uses the real canvas/camera ray and accepts only interactive
hits. Opening blocking panels releases PC pointer lock; menu clicks must not
capture it. Explicit clicks select hovered entries even when initially unselected.
Tab switches refresh the item source before selection. Keep quantity Max/Zero
and on-screen keyboard clicks distinct from their confirm actions.

Regression tests exercise real gameplay-frame and co-op receive wiring for enemy
labels and state/buff expiry, late icons, primary icon-cell identity, original
window frame/cursor regions, map positions/loop seams/transfers/cache limits,
legend pages, PC/VR menu controls and pointer interactions. A private browser
preview used the installed game's artwork and map read-only, plus a simulated
wrist anchor. This is not a headset playtest. Remove temporary preview HTML and
all private art before building packages. The dev proxy changes Host to the chosen
backend so the original launcher's localhost Host checks accept asset requests.

## Repeated update checks (0.2.11)

The .NET Framework WebClient removed its default User-Agent from the shared
Headers collection after creating the first request. The first GitHub check
succeeded, but subsequent checks returned HTTP 403 explicitly requiring a
User-Agent. Set HttpWebRequest.UserAgent and Accept for every request, including
release metadata, checksums and installer downloads. Preserve the verified
repository/version identity and download checks. UI errors distinguish rate
limits, server responses, missing releases, timeouts, TLS and connection failures;
server-directed retry timing is respected and identical consecutive log entries
are suppressed. The app does not infer that every failure means the user is offline.

Native regressions use a local HTTP server and sequential requests to reproduce
the consumed-header failure. Restoring the original behavior makes the second
check fail. Three consecutive live GitHub checks also passed after the fix.


## Separate desktop and VR presentation (0.2.11)

PC panels reuse their original game canvases, with a screen-aligned camera anchor
and sizes measured in CSS pixels. Fit the visible panel group inside the viewport,
including message/choice offsets and perspective depth, independent of camera
pitch, yaw, roll, FOV, zoom and resolution. Keep the HUD around 320 px at bottom
left and minimap around 220 px at top right; actual painted HUD height determines
the bottom margin. Menus hide the desktop HUD; VR retains the original head-facing
menu anchor and wrist HUD. Reset root scale and panel parenting on session changes.
Control hints are specific to keyboard/mouse or VR controllers in all four languages.
Regression checks project actual Three.js panel corners to screen pixels and
exercise resize, title, dialogue, transient panels and PC/VR transitions.

The source-built launcher now presents PC/VR choices before play, while advanced
RTP/browser/port/Steam integration and the diagnostic log are disclosures. Preserve
the original engine's controls and event bindings when reparenting them. Selecting
PC must clear both configuration AutoVr and hidden command-line VR/Steam overrides.
The verified engine binary is not changed. Branding is embedded in the source
launcher and Windows installer, including all native icon sizes and shortcut icons.

## Generated launcher branding

User explicitly requested generated app branding matching the game's atmosphere.
This is an exception for launcher branding to the original-asset preference; do
not replace the game's own status icons, window skin or tile art with generated art.
Used the built-in image_gen tool, not the CLI. Project assets are
apps/launcher/Assets/app-icon.png, apps/launcher/Assets/app-icon.ico and
apps/launcher/Assets/launcher-banner.png. The ICO is a format conversion of the
selected PNG into 16, 24, 32, 48, 64, 128 and 256 px frames, with no artistic editing.
These are original community branding assets, not extracted game files or an
original-author logo. Tests verify the embedded managed resources, native icon
frames, installer shortcut target/icon and uninstall cleanup.

Final icon prompt:
"Use case: logo-brand. Create one original Windows application icon for a community BLACK SOULS II VR launcher. Square image, dark gothic fairy-tale RPG mood, reminiscent of an old illustrated storybook. A single bold ivory-white rabbit-eared silhouette emerging from an antique keyhole, framed by a restrained dark-silver thorn ring; tiny muted crimson glow behind it. Rich charcoal and black background filling the square, warm bone white foreground, one deep blood-red accent. Hand-painted pixel-art-inspired edges and restrained engraved shading; strong simple silhouette must remain readable at 32 by 32 pixels. Centered symbol with generous safe margins. Flat front view, no perspective or mockup. No words, no letters, no title text, no VR headset, no neon, no busy background, no gore, no watermark. Original fan-project emblem, not a reproduction of a game logo. Deliver polished square raster icon artwork."

Final banner prompt (selected icon used only as a style/motif reference):
"Use case: stylized-concept. Asset type: wide launcher banner, approximately 3.6:1 aspect ratio. The supplied image is a STYLE AND MOTIF REFERENCE ONLY, not a target to overwrite. Create a new original Gothic dark-fairy-tale storybook header to match that ivory rabbit-eared keyhole emblem. Deep nearly black charcoal paper background, restrained aged silver thorn engraving, desaturated crimson accent. Reserve the left 65 percent as very dark clean negative space so the app can draw a readable live title and short subtitle there; put a smaller ivory rabbit-eared keyhole emblem with a restrained thorn halo in the right third. Maintain graphic clarity and quiet edges, delicate engraving texture and subtle vignette. No words, no lettering, no buttons or interface baked in, no watermark, no gore, no neon. This is the final banner artwork to be embedded in a Windows game launcher, not an application mockup. Wide composition with low vertical height."


## Empty icon cells and quick mouse presses (0.2.11)

Read-only inspection of the installed game confirmed primary IconSet.png is
384x936 with completely transparent cells 529 (Deadly Poison), 530 (Virulent
Poison) and 561 (Oiled). The matching game's archive has artwork at those indices.
Bounds alone were therefore insufficient. sheetForIcon now falls back for an
entirely transparent primary cell only when the archive cell has visible alpha.
Any visible primary pixel wins; failed/unavailable pixel reads keep the primary.
Cache alpha results per canvas/icon, including failures, to avoid repeated pixel
reads. Keep matching-game archive validation unchanged. Synthetic RGBA tests
cover real cell coordinates, occupied/empty cells, errors and cache read counts.
The private browser preview verified all three displayed Poison icons after this
fix, as well as PC mouse opening of the map and simulated VR wrist placement.

Mouse down/up can both arrive before the next animation frame. Buffer button
press edges until endFrame so rapid completed clicks reach menus once, without
changing held button state. Clear queued edges on blur and pointer unlock. A
real Input/ListPanel regression reproduces this sequence and verifies one action.
The title menu also counts as an active pointer UI even without menuOpen; clicking
Continue/New Game must not request pointer lock. Gameplay clicks still capture it.


## Borderless launcher and HUD clarity (0.2.11)

The user explicitly requested borderless game-launcher chrome. Retain accessible
close, minimize, maximize/restore, dragging, edge resize, keyboard close and
working-area bounds rather than removing window management. Custom Close must
use the original form's cleanup path. Advanced/settings controls remain native
and preserve their original events. Keep all visible instructions and disclosures
localized. A standard native language selector is preferable to unreadable styling;
FlatStyle.Flat omitted its selected text in offscreen native renders.

HUD resource labels/values belong with their corresponding gauges, with currency
and the game's optional SEN variable on a separate row. Group original status
icons and names together, preserve all status pages, and invalidate cached painting
when player name or level changes. Use the game's Window palette for resource
colors (HP20/21, MP22/23, stamina28/29) and retain real numeric values. Desktop
bottom anchoring follows actual painted height; the VR minimap must clear the
resized HUD geometry. Avoid new decorative status artwork or overlapping labels.

## Themed scrolling (0.2.11)

The launcher uses a dark track and ivory/gold thumb for its scroll surface and
expanded log, retaining the original read-only TextBox and its selection/copy
behavior. Preserve mouse wheel, drag, page clicks, keyboard navigation, focus
visibility and clamping when resized or disclosures close. The DPI gate measures
text fit and separation within the actual monitor work area; a fixed pixel width
after 150 percent scaling incorrectly assumed a monitor larger than the CI runner.
Include measured geometry in failures and exercise a small work area explicitly.

Long in-game ListPanel/GridPanel menus reserve a right gutter and reuse the
original Window frame/cursor artwork for track/thumb. Hide the bar when all rows
fit. Mouse wheel, track clicks and dragging move the viewport without activating
items, preserving the inventory column and explicitly unselected choices. VR
retains stick navigation and cannot trigger an item through the bar. Regressions
cover first/middle/last positions, partial rows, clamping, disabled items,
unselected choices, stale hover, wheel routing and cancellation during scrolling.
Esc/menu cancellation must take priority over wheel inertia or an active drag so
that a scroll handler cannot consume and lose the cancel key edge.
A private browser preview with
the installed game's original skin/icons confirmed wheel and drag behavior and
clear counts/text in long lists and inventories. Do not ship preview fixtures or
the original game artwork used during this check.

## Desktop player presentation (0.2.12)

The user explicitly rejected the Character and Save/Load group layers added in
0.2.11. The active design follows the installed original Scripts.rvdata2:
Window_MenuCommand adds item, skill, equip, status; the active Covenants script
adds partner; then save and game_end. Formation is commented out. Keep those seven
commands directly accessible in that exact order, commands/economy at the left
and party information at the right. Mod tools has a separate right-side button
and F1 shortcut, with Map, Load, Co-op, Settings and pose tools. Returning from a
core scene restores that row; Settings returns to Mod tools. Original Z/Enter and
X/Esc support stays intact. Do not add categories around familiar game commands.

Classic menu canvases are 320x960 and 960x960, matching the original 160/480 column
split at twice the logical resolution. They share the original Window skin and
actor face cells, with SEN and currency at the lower left. Do not invent party
members or borrow unrelated portraits. Hide old commands before asynchronous
save/load requests and only show the overview for the actual main menu.

The original active battle face script crops x=0,y=38,w=96,h=24 from each actor's
96px face cell. Use the runtime actor's faceName and faceIndex for the PC header.
Window_Base's actual HP palette is 18->10, MP is 9->1, and gauge background is 19.
Actor_bg1/2/3 belong to the original map HUD; gauge_bg belongs to enemy HP, so do
not describe those as battle HUD artwork. These findings were verified against
the installed game's live script/archive data; copied research assets remain
outside Git and the distributed package.

The desktop resource card has a fixed 256px painted height inside its 512px
canvas. A separate 512x128 effect strip keeps the first four priority effects
stable and directs overflow to Menu > Status. Do not time-cycle PC debuffs or
move resource gauges when effects change. VR retains its previous wrist drawing.
Translucent backgrounds preserve scene visibility; keep original icons, resource
values and outlined text legible. Window has two alpha-composited background
layers; count both when testing opacity. The PC mini-map is a 360px circle with
terrain at alpha0.6, transparent surroundings, opaque player/exit markers, and a
thin original-palette rim. Full maps and the VR mini-map retain their prior layout.

Pickup notifications use a separate RewardFeed camera anchor, never the central
menu-fitting root. Merge repeated identical gains, admit bursts calmly, bound the
queue, pause hidden timers, and keep the painted feed below the central view at
the lower right. Hidden narrow windows wait rather than overlap the HUD. Normal
nonblocking PC notices also use a separate corner anchor. Preserve actual item
and soul awards, source icons, co-op gifts and scripted event gains.

PC choices resize to their contents, with hit targets following the actual row
origin; blank titles do not reserve an empty header. Dialogue groups anchor along
the screen edge specified by the original message position; speaker tabs fit the
name. Preserve transparent/dim scripted backgrounds, disabled choices, number
input, mouse/keyboard edges, scrolling and VR dimensions.

PC equipment is a bounded visual wrapper around the original model, held low at
the sides. Do not shorten combat reach or move the shield interception point.
Hide PC held equipment during dialogue, shops, menus and transfers. VR controller
transforms, grip adjustments and model proportions retain their original behavior.
Regression checks project all weapon types/shields at several FOV/aspect ratios,
exercise real combat frame visibility and swing endpoints, and verify those
gameplay/VR invariants. UI checks cover original menu order, direct paths, exact
game asset cells, alpha composition, compact choice hit targets, asynchronous
save transitions and real loot rewards reaching the peripheral feed.

Private browser QA rendered Map101 with original tiles, Window, icons and faces,
checking exploration, the classic menu, dialogue, low weapons, translucent circular
map and merged lower-right pickups. Review images are ignored under dist/previews.
The temporary fixture and export middleware are outside distributed sources and
must be removed from the client before building. The private data server uses an
isolated temporary save directory; it must not modify the player's installed saves.

## Resized panel GPU storage (0.2.13)

The user's stretched Status screenshot exposed a GPU lifecycle bug. Panel.resize
changed canvas dimensions while reusing an uploaded CanvasTexture. Three.js r170
allocates immutable texStorage2D on the initial upload; subsequent texSubImage2D
uploads cannot resize it. The renderer could retain Status pixels while the main
menu used its narrow command geometry, or stretch old commands across Status.
Node canvas/layout tests did not allocate GPU storage and missed the defect.

Recreate the CanvasTexture and its Source whenever pixel dimensions change,
preserve sampler/color/UV settings, update the existing material map and dispose
the previous texture. Texture.copy shares Source, so restore the fresh Source
after copying. Keep the mesh and material stable for pointer hit targets. An
unchanged size is a no-op; world-width-only changes replace geometry without
clearing the canvas or reallocating texture storage.

Regression tests exercise actual main/status/equipment/back transitions, texture
and source identities, disposal, unchanged/world-only resize and adaptive choice
and speaker-name panels. Private browser QA reproduced distorted old pixels before
the fix, then verified repeated Main > Status > Back > Equipment > Back > Status
and dialogue on actual WebGL rendering with original game art. Test state remains
synthetic and the fixture never reads or writes player saves. Preview fixtures and
export helpers must stay outside production builds and release packages.

## Live exits, complete choices and pointer handoff (0.2.14)

Exit rings must follow the current usable event page, not only the pages present
when the map mesh was built. GameMap.exitRevision invalidates route presentation
after event page changes. collectCurrentExits reads live, non-erased event pages
and the revision cache records pages during loading. Repeated null/erased-page
callbacks are not route transitions and must not churn marker GPU resources.
The collector uses current pages and runtime coordinates with the existing
transfer-analysis rules. Update world
markers and navigation analysis together, without rebuilding collision or geometry.
Show rings immediately with cached/fallback destination names; asynchronous name
loads must check the map, presentation token, revision and exit-array identity
before refreshing labels. A moving event also invalidates its presented route.
Preserve boss blocking, looping-map coordinates and integer tile-centre floor
sampling. Dispose per-marker materials/geometries/label textures on rebuilds and
retain the shared ring/column textures. Never synthesize a route from inactive
pages, death common events, or unrelated cutscenes.

PC dialogue answers must show their complete text, including long translations,
instead of truncating consequential choices with ellipses. Wrap words and CJK
characters, keep hit regions aligned with painted rows, and scroll excess options
within a readable viewport budget. Wide choice boxes must clear the speaker tab.
Number inputs and VR retain their established row dimensions and controls.

Returning from pointer-driven UI must restore gameplay input without requiring an
extra mouse click. Preserve intentional native Escape release from ordinary play,
window blur, text entry and VR. Browser Escape may deny immediate pointer relock;
use a bounded handoff and movement-key recovery rather than per-frame lock spam.
Regression tests cover route page transitions, marker positions and disposal,
wrapped choice text/hits/scrolling, and pointer pause/resume lifecycle. Private
browser fixtures exercise the real renderer with original art and synthetic game
state; remove them from the client before production builds.

## VR world pickups (0.2.15)

Read-only inspection of the installed original data confirmed that Mental Ward
(Map012) exits to Lutwidge Town (Map005). Its item drops use trigger-0 !Flame
events with ordinary positive item commands and collected pages; chests use the
same original event pipeline. Keep original game data and private inspection
scripts outside Git and release packages.

Input.grabPressed buffers WebXR squeeze edges independently of combat polling.
Fast start/end pairs between frames count once. Event-capable controllers must
not replay delayed gamepad polling. Clear stale grabs on UI, session/source loss
and controller replacement; grips held through a menu need a new squeeze.
Preserve existing shield, pose, consumable and other sampled button semantics.

WorldPickup runs after sprite placement. Check physical hand proximity to the
actual visible mesh or slab, trim upright sprite alpha margins, require short
head-to-hand reach and clear static-world sight lines. Ignore hidden, inactive,
stale, occupied and boss-blocked targets. Shield grip keeps guard; the right
grip and an empty left hand can collect. Detect positive event rewards only to
identify object interactions, then dispatch Player.startActionEvent. Inventory,
messages, choices, switches and network authority belong to the original event.
Never give inventory directly from the grab handler.

Action targeting uses rendered support positions and nearest map-loop copies.
VR prioritizes actual controller aim before tile fallbacks; desktop keeps its
tile-first behavior. Preserve script-facing direction and propagate refused
starts instead of falling through to unrelated underfoot items.

Regression tests exercise real GameEvent/Interpreter/GameParty transitions,
collected pages, co-op refusal, hand ownership, occlusion, visual placement and
WebXR squeeze/source lifecycle with synthetic fixtures. These are simulated
controller tests, not a physical headset playtest.

The clipped-command screenshot was a shared-canvas drawing-state leak:
paintClassicMenu ended economy drawing with textAlign=right. A same-size list
redraw reused that alignment and painted command text mostly left of the canvas.
Set list text alignment explicitly and save/restore the appended economy's
canvas state. Tests reproduce actual open/selection/hover/Status/Back redraws
without resizing, and assert complete text bounds and stable texture identity.
Fresh interactive browser verification was stopped by the user's physical
Escape; do not claim that the current changes received a new browser playtest.

The installed Run like Dodo skill 340 invokes common event 43, whose Normal/Fast
choices run player move-route command 29 with speeds 4/5. It is a persistent route
setting, not a battler status. Free Player locomotion must multiply its PC/VR,
sprint and guard factors by the original exponential speed-index ratio. Keep
forced routes on their own existing grid movement. Save optional start.moveSpeed,
restore it when entering a world, and import original player.move_speed. Old or
invalid values default to 4. Regression fixtures use synthetic skill/events;
private read-only verification of the installed event confirmed 2x Fast distance
and 1x after Normal without changing actual game files or saves.

Co-op home snapshots must include the current live movement speed even if the
player has not saved since choosing it. Preserve that speed during a summon and
restore the home speed on return; the visited world's later route changes do
not rewrite it. Legacy snapshots use their saved speed or the normal default.

The Torture Chambers rack is Map 063 event 3 at (27,17), !$Map1_c direction 8,
pattern 1: a 32x96 rack frame drawn from above. Its selected frame also leaves
18 bottom rows transparent while an unrelated frame reaches the bottom, so
all-frame margin minima suspended it by 0.84375m. Known rack and
Map1_b table/bed frames use original selected pixels horizontally with visible
thickness and floor-reaching supports sampled from their artwork. Keep adjacent
shackle columns hanging and cupboards/instruments upright. Selected-frame base
grounding is limited to verified stationary Map1_b/wooden-horse props; preserve
wall attachments and actual top surfaces. Tests cover geometry, support height,
source-frame selection, page changes and resource disposal. Private N-API canvas
inspection used actual local art without computer control or saves access.
