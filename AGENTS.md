# Developer notes: BLACK SOULS II VR

## Product requirements

This is a client application for players. Keep the installer, launcher, help,
README and release notes focused on installing, launching, controls, saves and
troubleshooting. Do not put repository structure, libraries, build commands or
CI/CD explanations into player screens or guides. Keep developer documentation
in this AGENTS.md; include it in the installed application for developer access,
without displaying it during setup or linking it from the player menu.
Retain the original-author credits and license files. Player-facing branding
uses BLACK SOULS II VR; contribution provenance belongs in developer notes and
the pull request, rather than repeated community-edition banners.

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
./tooling/release/build_installer.ps1 -Archive dist/BLACKSOULS_VR_0.2.2.zip -Version 0.2.2
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

## Gameplay effect audit (0.2.16)

Keep walking speed, AGI, attack-count traits and extra-action traits separate.
Original Game_Action.speed adds AGI, random order, item.speed and normal-attack
feature 33 to choose turn order. It does not define walking or animation speed.
AGI equipment/state multipliers already change real stats and formulas such as
Triple Shot/Thousand Arrows. Enemy windups and companion movement/actions use AGI.
Do not claim manual player actions reproduce the original turn-order scheduler.

Feature 61 extra actions adapt to shorter player recovery using the same expected
action-count idea as enemy actionPace: 1 plus the extra-action probabilities.
Snapshot per action, shorten desktop swings and PC/VR ranged base recovery, and
preserve burst spacing, hit counts, costs, deliberate charge time and turn-based
skill cooldowns. A short desktop swing crossing its active interval during a
slow frame must still hit once. Physical VR melee keeps its gesture thresholds
and per-target debounce; do not turn one held pose into repeated free attacks.

Weapon/state effects must use actual attack and damage paths. Normal attack state
traits include death state 1, combine rates for a given state before rolling and
apply original resistance/rate/LUK rules. This release retained the groggy
replacement for stun; 0.2.17 below restores the original weapon status.
Keep full legitimate attack counts (upgraded Hans' Machine Gun reaches 12 hits),
with bounded validation for malformed values. Accuracy penalties, skill success
rates and target critical evasion must participate in real hit/critical rolls.
The original normal-game critical multiplier is 2; do not silently replace it.

Script 193 reads damage-rate piercing tags from feature objects and a differently
spelled additional tag from skills, while the installed data puts the former tag
on many skills (including weapon 445's attack skill 591). Accepting both spellings
on the skill is an intentional compatibility repair of that original data/script
mismatch. Preserve physical/magical type and original feature-object tags.

Passive EVA/MEV must work without a counter-on-evasion note. Original active script
173 changes ordinary counters to apply the incoming hit first, then counter if
the target can act. Select CNT before MRF, preserve evasion and miss application,
and do not negate the incoming hit because CNT won. Normal counters use weapon
attack-count traits for consistency with this port's normal attacks; original
Ruby invokes item_apply directly, so this is a port adaptation rather than exact
original counter repetition. Incoming criticals roll enemy CRI times (1-CEV)
after hit/evasion/substitution and apply the original normal-game multiplier 2.
Zero/absent CRI, full immunity, effect-only and noncritical skills do not consume
an extra RNG roll. Guards and attack-first counters keep their existing order.
Critical multiplication applies only to formula damage, not independent
percentage HP effects attached to the same skill. Preserve the separate incoming
damage multiplier for those percentage effects.
Death-only enemy skills (e.g. skill 310) must
use the existing death/save/revive flow after a real hit, respecting resistance
and perfect guards. Existing nonfatal hostile-state scaling remains a separate
real-time adaptation. Enemy regeneration must not depend on having state timers;
positive HRG heals to maximum HP and never revives a dead enemy.
Reflected death also targets the original spell caster, using that caster as both
user and target for susceptibility/LUK. Preserve player death saves and enemy
revival through the existing fall/death handlers; never invoke reflection again.

Use synthetic database fixtures for shipped regressions. Read-only inspection of
the installed original scripts/database stays private. These checks establish
specific effect behavior, not exhaustive compatibility for every story event.
The user chose gameplay effects first while the game was closed. The stationary
skeleton screenshot remains unidentified and needs a later live inspection; do
not claim this release fixes that particular object.

## Weapon stun restoration (0.2.17)

The user reported that Great Sword's advertised stun never triggers. Private
read-only verification found weapon IDs 123-132 have feature 32/state 13/value
0.8. Attack 1 and Mow Down 81 carry the normal-attack-state effect. State 13
restricts actions, uses original icon 21, and lasts one turn. The inherited
normal-attack loop explicitly skipped state 13 and converted its chance to a
groggy bonus; 0.2.16 retained that exception, so it did not restore weapon stun.

Apply weapon stun through the shared stateEffectChance/addEnemyState path,
respecting actual hit, susceptibility, immunity, LUK and original ignore tags.
The existing restriction handler cancels windups/actions and their telegraphs,
prevents AI actions, and resumes after the enemy-state timer expires (one enemy
turn is two seconds in this port). Existing status display uses the original
state name and icon. Keep ordinary groggy/Break mechanics, but remove the old
stun-to-groggy bonus now that the weapon's original status is applied directly.

Four regressions failed against 0.2.16 and pass with the fix: actual attack
interruption/status display/expiry/AI recovery, chance/resistance/immunity/misses,
VR and direct-skill application, and independent groggy buildup. Private runtime
verification used the installed Great Sword, Attack, Mow Down and Stun database
records against synthetic battlers with no player-save access. Both attacks
applied the real state, restricted actions, and expired after two seconds. Keep
original data outside Git/releases; these checks are not a live headset playtest.

## Dialogue transition presentation (0.2.18)

The user reported flickering between normal HUD and dialogue. Map logic runs
before UI input in a rendered frame. closeMessage cleared msg during UI.update,
so HUD/minimap/backdrop/cursor could switch to gameplay before the next logic
tick opened the following page. At high refresh rates several render frames can
occur without an intervening logic tick. Desktop equipment has a separate earlier
update and must follow the same presentation lifetime.

Pass the source interpreter separately to showMessage. Track its root execution,
map identity and map ID for presentation only; messageBusy must become false
after an answer so that original event logic can proceed. Keep presentation
stable through consecutive messages, choices, common-event children and scripted
waits. Retain the acknowledged panel only until its source leaves the message
wait, allowing the next page to replace it before rendering. Hide old text during
explicit waits while preserving HUD suppression and backdrop. Release on root
completion, reused interpreter setup, map/transfer changes, battle waits or death;
explicitly clear held presentation on title/game-over transitions. Source-less
UI prompts retain their existing immediate-close behavior. VR retains its wrist
HUD and physical equipment presentation.

Regression checks must reproduce map-logic-before-UI-input ordering, including
frames with no logic tick. Assert real panel/HUD/minimap/backdrop/equipment and
pointer state, original wait/choice effects, no opening-frame input reuse, and
normal gameplay restoration. Use synthetic data and do not claim a physical
headset or original-save playtest from these checks.

## Original-game fidelity audit (0.2.19)

Read-only checks covered 410 installed maps, common events, troop pages and the
active original Ruby scripts. The script/formula inventory contained 4,344 calls,
773 distinct snippets and 104 unsupported SteamUserStatsLite achievement calls.
Every non-Steam snippet compiled in the adapter; compilation alone does not prove
story compatibility. Steam achievements remain unsupported in the browser port.
Keep all inspected original data, scripts and numeric reproductions outside Git
and release packages. Shipped regressions use synthetic fixtures.

Resource routing follows original Game_ActionResult/execute_damage: types 1/5
take HP and 2/6 take MP; MP damage is capped by available MP. Drains return only
the resource actually available, capped by the caster's maximum, and do not use
recovery multipliers or recovery nullification. HP damage may still display
overkill. Independent percentage effects are separate from formula criticals
and drains. Use the same routing for player, enemy and reflected attacks.
Normal enemy attack state effect 21/data 0 expands attacker attack-state traits,
combines each state's rate and uses existing susceptibility/LUK/ignore rules.
Keep the existing nonfatal hostile-state scaling and guard behavior as real-time
adaptations. Verified original examples included Brain Sapper's MP Attack, Skull
Shroom's Drain Mana, Star Spirit's Drain Life, Rotting Dog and Great Serpent.

Co-op keeps existing 15/17-field enemy tuples. Optional top-level mp metadata
and signed md hit changes carry resource loss/gain through existing peer/map
authority and rate checks. Validate integer bounds, preserve zero and accept
legacy messages without metadata. Fresh puppet snapshots must not rewind either
a local MP loss or gain before its report reaches the host.

Inventory gain/loss requests a map refresh, as original Game_Party.gain_item did;
26 original item-conditioned event pages include key gates and Train Ticket.
Include-equipped losses consume the bag first, then exactly the remaining
shortage across party equipment. Equipment trades check ownership and slot type
before moving anything. Player choices obey fixed/sealed slots and equip types;
event changes can still clear fixed slots. Release newly invalid gear only after
an actual equipment change, returning it to the bag unless force-changing.
Active VXAce_SP1 repeats releases until stable; removing later gear can invalidate
an earlier slot's permissions. Every productive pass removes at least one item.
Previews simulate those releases without inventory changes. Loading existing
gear is not a migration. Original Hunter's Attire seals the head slot.

Original-save import keeps valid state_steps/state_turns and buffs/buff_turns.
Convert remaining buff and leader timed-state turns at the existing six-second
player/companion rate; persistent states receive no invented expiry. Retain
legacy defaults when fields are absent and native-save serialization of clocks.

Interpreter command 352 called a nonexistent UI method. It now opens the actual
global save flow and waits through slot loading, overwrite confirmation, write,
retry or cancel. Event Save closes back to the event; ordinary menu Save retains
its return to the main menu. Stale map responses must not reopen departed panels.
Common event 294's adjacent boss-skull choice blocks merge into one three-option
menu under the original choice extension, so saving must not select a transfer.

These checks verify specific rules, not a complete story or headset playthrough.
Original turn order and the port's real-time action scheduler remain different.
The previously reported stationary skeleton still needs live identification.

## Area atmosphere and foliage (0.2.20)

The user wants recognizable original-game atmosphere across locations and reports
cut artwork, plain skies and cubic forest borders. Read-only metadata checks
covered all 410 maps. Original map notes often specify tone, automatic weather
and a map-fog image. Do not infer enclosure from weather or a nonempty parallax:
342 maps have no parallax, including actual outdoor towns, forests and snow.
Use verified tileset families and narrow source-tileset-guarded map exceptions;
unrecognized and picture-only maps receive the neutral readable fallback.
This is a shared presentation repair, not a claim of manually remodeling 410 maps.

MapAtmosphere owns diffuse support, a restrained neutral local light and visibility
distances. Original painted shadows should remain legible without a universal
brown torch or black dungeon fog. Apply map tones through the natural-colour
policy below once on entry; geometry
rebuilds must retain scripted tone/weather changes. Missing tone/weather notes
reset to neutral/none, like original automatic scripts 133/134. Title/game-over
teardown clears generated weather/effects and the previous map's tone.

WorldTone composes material shader hooks instead of adding framebuffer copies
or per-eye passes. In the pinned Three r170 shaders, output color conversion
precedes fog. Apply weighted grayscale, then signed RGB offsets after fog and
before alpha premultiplication; retain alpha and handle linear output explicitly.
Share uniforms, preserve original onBeforeCompile/cache keys, discover future
dynamic meshes and retain materials only weakly. HUD, menus, pictures and overlays
are excluded by render order/depth testing or an explicit worldTone opt-out.
Background colors always derive from a raw clone rather than accumulating tint.
These are RGSS-compatible color semantics, not proprietary GPU pixel equivalence.

Automatic weather and interpreter command 236 use rain/storm/snow/none, power0-9
and logic-frame interpolation. Weather is depth-tested world geometry: reusable
buffers, ten particles per power level, no particle lights. Keep flakes small
enough to avoid large white blocks near the eye. Cloud dimming composes once.
The original RichFog, Sunshine_1/2 and fallen_leaves01-04 images supply map mist,
light cards and twelve leaf styles; load them from the selected game at runtime.
Generated effects have bounded draw/instance counts, fade near the head and
dispose GPU resources on stop/transfer. Persist only original Game_System cue
settings (rich fog, sunshine type/position and leaf type); Game_Temp particles
never belong in saves. Import those four settings from original saves.
Subtractive radial kurayami images are edge masks, not uniform fog density.

Authored sky panoramas have priority. Outdoor profiles without a usable sky may
borrow original cloud/star panoramas appropriate to their tone and region.
Cloud fallbacks cover the horizon and poles with image detail; avoid a large
plain lower band. Preserve the sky setting, cancellation tokens, fallback colors,
cached horizon restoration on rebuild and single disposal of shared textures.
The original moon-over-lake panorama is a sky despite its name containing 湖;
only its water portion belongs on the ground plane. No original art is bundled.

Connected tree artwork had been promoted to SOLID_MASS by component size,
creating opaque backing, stretched sides and consumed canopy art. Verified
foliage cells on do2 and the two snow sheets stay alpha-aware picture stacks
even above impassable grass. Preserve pre-existing A3/A4 walls, forced solids,
cliffs, rocks and buildings. Original MapGrid passage remains authoritative;
removing an invented visual mass must not open blocked forest paths. Validate
source-frame coverage, alpha silhouettes, unchanged architecture and collision
with synthetic regression art. Private actual-asset checks remain outside Git.

The do2 border cells128-167 also bake opaque RGB(8,9,22) into 2D empty space;
cell137 is entirely this matte. The 3D presentation drawer makes only exact,
edge-connected matte pixels transparent. Preserve enclosed equal-color pixels,
dark bark and all unrelated sheets/cells. Cache the filtered per-tile canvas;
unreadable pixel data conservatively uses the original image. Use untouched
source pixels for joinsBelow/joinsBeside and logical assemblies: using masked
alpha for connectivity split whole trees into independently placed fragments.
The ordinary 2D TileDrawer remains unfiltered. Full-renderer QA confirmed attached
canopies/trunks and removed panels after both geometry and source-matte fixes.

Visual QA uses original map/asset rendering and disposable debug state, never
player saves. Combat may be paused in a private review harness to keep cameras
stationary; this is visual inspection, not a full playthrough or physical headset
test. Temporary review pages and export controls must be removed before builds
and kept out of production/release packages.

## Water support, scenery grounding and picture cancel (0.2.21)

The Carroll River report identified a boat and icy rock rendered at floor zero
above the parallax water. Empty water cells must use the exact OPEN_LEVEL of
the rendered water plane rather than a neighbor-height or zero fallback.
Fully clear, impassable nonanimated source tiles over water are collision
markers, not backed solid masses. Normalize their presentation only after
confirming the source image loaded and every alpha is zero; low-alpha visible
art and unavailable images must not qualify. Original grid passage is unchanged.

Grounding must measure the pixels actually rendered at the foot: remove the
same shadow removed by requestUpright and use its 0.4 alpha cutoff. An empty
padded column beside an assembled stem is not a foot and cannot prevent the
whole picture from dropping to its real support. Preserve elevated/arch/wall
attachments and real counter support. Bound numeric horizontal key lookups in
both map and event picture assembly; (width,y) aliases (0,y+1).

Private full-sheet inspection supports selected-frame grounding for stationary
object-sheet wagon/parasol frames, Other3 slots1-3 and Map1_a slots1/3/5.
Other3 slot4 contains physical rocks/posts with animated water ripples; its
per-direction bottom remains constant through all three animation patterns.
Allow that animation while preserving normal-priority/no-through/no-movement
guards. Reevaluate the profile at placement time so a same-graphic event page
change cannot leave stale eligibility. Moving hands, flames, windows, nooses,
wall altars, real flying actors and mounted pictures retain their existing rules.

Private scans covered 410 original maps and all graphical event pages, using
actual source canvases and entry reachability. The checks identify consistent
water support, picture grouping and visible-foot geometry; they cannot prove
every story-switch configuration or physical headset behavior. Review flags
for wall/bridge attachments are not automatically confirmed floating bugs.
Keep all original images/data, contact sheets and raw audit reports outside Git
and releases. Shipped regressions use synthetic maps and artwork.

Do not correct the Carroll ferry by stretching its stairs or raising water
independently of its terrain. Verified VXTileE cells102/107 are complete bridge
decks, not stairs. When such a deck is passable and not solid/pit, an underlying
bank face must not split same-level floor components. The prior inferred drops
sank connected islands from0 to-2 to-4 and placed water6.675m below the ferry
landing. Correct deck classification joins the reachable islands at0, keeps the
landing at0 and water at-.45tile (-.675m); all11 boats and the16 icy rocks/two
posts then have their visible bottoms on that surface. Restrict to actual
source-sheet identity/cells; rails, broken pieces, true stairs, inaccessible or
blocked decks, walls and original passage flags retain their rules.

The moon picture is owned by a separate original autorun, not by the action
event's lifetime. Browser-native Escape pointer unlock may omit keydown, so
queue the original RPG Maker B/code12 condition until the next map logic tick
(G.frame epoch), surviving intervening render-only frames. Exclude scripted UI
unlocks, busy UI, VR and focus loss; blur flushes the cue. Do not inject generic
UI cancel, edit story switches directly or erase all pictures at event end.
Private replay of the original Map9 telescope/autorun confirms picture1 is
erased and switch393 clears while an unrelated persistent picture2 survives.
The original Leave choice never displays the moon. Tests include async picture
loading and ordinary keyboard/controller cancel behavior.

## Horizon sky coverage and semantic viewer exit (0.2.22)

Map9's authored Moon Lake panorama used the legacy cylinder plus a constant
upper-hemisphere colour. Its 1280x720 aspect with two repeats ends the image at
roughly41.46 degrees elevation, producing the reported large plain-blue circle.
Keep the original horizon projection and add a small inward spherical cap with
azimuthal UVs and a smooth overlap below the cylinder's top. Verified sky-only
crops come from the selected game's original panoramas at runtime, never from
bundled game images. Moon Lake's right30%/top256-of720 pixels contain stars
without its moon, flare or water. Other audited named crops avoid churches,
ships, mountains and sea. The Moon Surface's genuinely black empty space and
unverified custom panoramas retain their original rules. Full-sky domes retain
their existing projection. Resource cleanup must dispose both horizon/cap
textures once; tests ray-check visible textured coverage through the zenith,
preserve the original cylinder, and verify crops with synthetic marker pixels.

The user's still-persistent moon was verified against the running .21 bundle;
the missing path was Tab/M/N or left-Y opening the port menu/map. Those are
different from original B and deliberately perform a scripted pointer unlock,
so the earlier native-Escape bridge correctly did not run. Menu/map entry now
asks PictureLayer to recognize an active autorun/parallel controller whose true
B12 branch erases a currently visible named picture, then requests original B
for the next map-logic epoch. The original controller performs its own switch
and picture cleanup. Do not erase pictures directly or globally map menu keys
to B. Ignore erased/inactive/action pages, Else/later unrelated erases, wrong
button codes, unrelated picture IDs and hidden images. Keep persistent pictures
and the newly opened port menu. Original Map9 data and real UI/Input were
privately replayed for all four entry controls after12 viewing ticks; picture1
and switch393 clear on the next tick while persistent picture2 survives.
No original assets/data or private review controls enter the release.

The original telescope autorun also repeats Show Picture every logic tick.
Replacing its loaded image with null lets the asynchronous cache promise resolve
only after that frame renders, causing flicker or invisibility at steady60Hz.
Reuse ready artwork only for the same picture ID and name; reset the other
Show Picture fields normally. Preserve identity checks for pending replacements
and erasures. Regressions must render synchronously after each repeated show,
and confirm a delayed image cannot resurrect a viewer cancelled from the menu.

## Steam achievements from earned events (0.2.23)

The104 distinct installed achievement snippets at140 event locations use an
exact three-line SteamUserStatsLite singleton/set/update block. They previously
failed Ruby compilation. Interpreter355 recognizes only that block, preserving
the exact case, whitespace and UTF8 of its quoted API ID; general Ruby, formulas
and previews do not gain a Steam helper. Record only an actually executing355/655
block in an owned local game. Deny dev/map/save/timer launches, phantom/replay,
spectator and developer-world sessions. Keep pending earned IDs in
GameState.system.steamAchievements (bounded256, deduplicated) so ordinary mod
saves retain them. Native confirmation alone removes a request. Capture its save
identity across asynchronous requests; loading another save must not redirect an
old response. Do not infer historical awards from boss switches or inventory.

The launcher creates app/steam-session.json for its current session and serves
a token-authenticated endpoint bound exclusively to127.0.0.1 on an ephemeral
port. Accept only the selected game's localhost/127.0.0.1 origin and exact bridge
Host; do not enable arbitrary CORS or bind to LAN. Limit concurrent requests,
header/body sizes and total reading time. Delete only this launcher's own config
on close. Do not block the UI on an in-flight Steam callback. A terminal native
failure disposes the worker so a later attempt can reconnect after Steam starts.
Keep credentials and connection details out of player screens and release files.

SteamAchievements.exe is a separately source-built x86 child because the owned
game's steam_api.dll is32-bit. Load that DLL by its full selected-game path, use
only process-local app context3855540, verify Steam login/app/ownership/account,
and shut down on launcher exit or stdin EOF. Never ship/copy the game DLL or
create steam_appid.txt. The native API exposes only status and earned-name batches,
with no clear/reset/stat editing. Enumerate published achievement names at runtime
and reject any unknown name before a mutation. The current installed schema has
102 achievements; script IDs absent from that schema cannot award.

Manual dispatch waits for matching successful stats callbacks. On Windows,
UserStatsReceived_t is24bytes but its packed CSteamID begins at offset12; a
sequential managed ulong at16 silently rejects the correct account. Preserve the
raw-byte ABI regression. SetAchievement/StoreStats returning true does not prove
server persistence. Keep dirty IDs separate from initial downloaded/confirmed
achievements; acknowledge only a matching successful UserStatsStored_t callback.
Do not overlap stores or mistake a late callback for a newer batch. Preserve
pending work on rejection, timeout or disconnection, with bounded quiet retries.

Tests use fake native APIs and synthetic events, including Unicode IDs, offline
recovery, failed stores, late callbacks, save identity, lifecycle and HTTP origin
authorization. The private read-only probe against the installed game confirmed
ready/102 names, including a Unicode identifier; a real process/HTTP bridge test
and original server metadata routing also passed. No real achievement was set or
stored during verification. Keep all original scripts/maps and private reports
outside Git and release packages. CI builds/tests/promotes both launcher binaries;
package checks require the x86 worker and exclude Steam DLLs/session credentials.

## Battle tone lifetime (0.2.23)

The clock-tower Troop187 turns the view white on turn1+20n and resets it on
turn10+20n. Winning early left the global ScreenFx tone permanently white. VX Ace
uses separate Game_Screen instances for map and troop, so bind interpreter223
tone changes to their active battle (including common-event children), retain
independent map tones, and drop battle channels on finish/reset. Stale troop
continuations cannot repaint a map. Keep the authored blind/reset timing while
the battle remains active; do not globally erase ordinary flashes or pictures.
Private original-page replay reproduced white after victory before the fix and
normal tone afterward. Synthetic regressions cover early victory, scheduled
fade, common children, stale continuations, overlap and PC/VR owner cleanup.

## University wide stairs and original falls (0.2.23)

Map155 uses three-wide evilcastle_A5 stair flights. The fall-height solver's
width>=3 flat-room rule merged those stairs with both landings, carrying the
gallery's height into the hall and leaving an upright wall across the route.
Original seven-row fall routes establish the gallery's height more reliably
than the decorative wall-row count. Only this map supplies fallStairs rectangles
with verified seven-tile rises. Exclude those cells from flat-room merging and
propagate their rise between placed areas or from their single known landing.
Do not globally reinterpret wide corridors or change original passage flags.

The real original build retains all13 fall routes and78 shaft cells: hall31,23
is0, gallery31,12 is7, the central eight-row flight rises smoothly0to7, the upper
flight rises7to14, and the small side exit rises7to10. Original blocked31,3 stays
solid; existing arrival/door logic retains authority. Wall caps/tops are local
Map155 metadata. Synthetic regressions use the actual command analyzer and
buildMapView, check wall triangles and both landings, and walk uphill/downhill
with real Player.update/resolve and GameMap.playerEdgePassable. They preserve
the original side-wall block and do not trigger falls on the ramp. Rendered
review checked the approach, halfway point and gallery. Private source maps and
art stay outside Git; dev previews disable saves and achievement submissions.

## Desktop / headset handoff (0.2.24)

The pinned Three r170 WebXRManager overwrites the shared application camera's
projection, FOV and zoom with headset values. Its native-session end listener
restores the entry framebuffer size/DPR but leaves that lens in place. Restore
the saved desktop lens and projection inverse with the CURRENT window size/DPR
only after manager sessionend; raw XRSession end runs before Three's cleanup.
Use the first valid XR viewer pose to preserve world heading and authoritative
current-map XZ. No delayed recenter may run after exit or capture an old map.
On exit retain physical XZ/look, normalize rig yaw and camera roll, and preserve
floor/jump/fall state. Title artwork uses entry-head coordinates even when an
old G.map remains retained after returning to title.

Input boundaries flush stale desktop and controller actions and require release
of initially held XR controls. Desktop soft look resumes only when it was wanted,
the page is focused and gameplay owns input. Menus/dialogue/name and number edits
retain state and repaint before their first render in the new mode. Without a
left controller, VR uses the small head-relative HUD until a wrist is available.
Failed/late session grants, rejected exits and uncancellable setSession promises
must not orphan a live session or clobber a newer attempt. Healthy exits do not
restart the browser XR process; actual failed granted starts retain recovery.

Spectator.prepare schedules the second WebGL context, compileAsync and hidden
geometry/texture warmup after PC map presentation. sessionstart and the first
unprepared XR render do not synchronously create/compile that monitor renderer.
Keep its context and uploaded resources across sessions, guard superseded map
preparations and restore frustum-culling flags after the hidden upload draw.

Regressions execute the real pinned WebXRManager/camera lifecycle with synthetic
platform frames and test input/UI ownership separately. Private rendered QA uses
original maps with simulated headset lens changes; no physical Quest timing or
headset playthrough was measured. Keep review controls/data outside releases.

## Terrain continuity and source floor semantics (0.2.24)

Private read-only height/edge analysis covers all410 original maps with the
direct-transfer arrival union from maps and CommonEvents. A height difference alone is
not a defect: ladders, side-facing stairs, authored terraces and genuine fall
endpoints must retain their rules. Original images/data and generated audit
reports remain outside Git/releases; shipped regressions use synthetic layouts.

Hanover Map161's winding passage widens enough to become artificial flat rooms
in the fall solver. It compressed an11-tile endpoint rise into one row. Only
excessive inferred, unprofiled, non-ladder ramps can extend through unanchored
degree-two passage groups. Bound the chain, require north/south endpoint rooms,
reject side exits/protected cells/overlap, and distribute the same endpoint rise
over its complete corridor. Preserve original fall rooms, shafts, explicit
profiles, walls and passage flags. The real passage now spans12rows with rise
11/12 per row; its original10-row cliff fall still drops10tiles.

Stomach Map42's A4 source sheet 食肉園 (3) uses autotile kind123 as a passable
checkerboard floor. That exact source/kind is excluded from wall-side inference
per layer; a different lower wall layer must still count. No other source slot,
kind or collision flag changes. The private real-map passable seam count drops
from18 to0. The graveyard Map313 metal stair has a transfer door rather than an
upper flat room; a bounded profile joins its original0/-2 endpoints through the
flat middle landing at-1. Real-map seams drop3to0; adjacent walls remain solid.

Unresolved narrow fall-map pockets inherit a level only when every placed,
originally two-way-walkable boundary agrees on one flat height. Mixed/sloping,
protected, blocked and unknown-room boundaries remain untouched. This completes
Hanover's eight sideways grass/hay seams, including the10to0 default-height
error at30,6to31,6, without altering its15 established fall edges or132 shaft cells.

Continued ladder/fall runs join the neighboring facing surface, not a sloping
cell's midpoint. Original Map56's0.5-tile ladder gap is gone; synthetic tests
cover both endpoints and retain a genuine fall. Chaos Maps217/282 explicitly
opt into passageLevels so blocked painted roof/lip contacts cannot merge separate
floors. Only those opted-in maps prefer a fully two-way-walkable climb over a
contradictory decorative wall between the same components; one blocked rung
cannot qualify. Original passage/solid/pit/empty classifications are unchanged.
Map217's wooden staircase and Map282's3to0 ladder each lose their one bad seam.

The final common-transfer-aware410-map comparison has0 errors:92 candidate
edges become60, exactly32 removed, with no new or increased gaps. Two false
Hanover single-row steep ramps also disappear. Remaining candidate edges were
checked against source art: stair/ladder side borders or authored side-facing
steps; Winterbell's steep front flights have continuous shared endpoints. The
Map309 roof flag is unreachable decorative art from both original arrivals.
This is a source/geometry and movement audit, not every story-switch configuration
or a physical headset playthrough. Preserve that distinction in release claims.

## Natural environmental colours (0.2.25)

The user now explicitly prefers natural source-art colours across every region,
including green forest grass rather than the original heavy red/desaturated 2D
screen grade. This supersedes the earlier instruction to reproduce complete
automatic environmental tones. Do not recolour the original game files or turn
authored autumn leaves, fire, blood or fantasy artwork into generic green art.

The red forest was caused by the original Map161/44/162 note
(34,-34,-34,170): weighted grayscale removes two thirds of source saturation,
then channel offsets overpower the remaining green. Neutral lights and the
pinned sRGB rendering path were verified; do not add compensating lamp tints,
gamma changes or a second tone pass.

ambientMapTone bounds environmental RGB spread to12, gray to12, and the common
negative brightness to-24; positive common brightness is discarded. Preserve a
small regional hint and darker nights without washing out source textures.
MapAtmosphere adapts notes once on entry. Interpreter223 adapts the actual
CommonEvent290 random weather/BGM list and exact restores of the current raw
map-note tone. Troop-owned commands always retain original strength and lifetime.
Unrelated scripted flashes, fades, blackouts and weather rules remain exact.
Geometry rebuilds retain current scripted state.

Adapt before the existing ScreenFx command. Its stored/networked tone is already
display-ready; co-op must not normalize it again. No new screen channels, save
fields or protocol metadata were introduced. WorldTone keeps its exact low-level
math and original overlay exclusions.

Private read-only post-policy audit reparsed all410 original maps:144 tones
adapted,266 unchanged; all235 neutral maps and all29 snow maps unchanged.
All4 CE290 candidates adapt. Across414 map/common-event tones,0 bounds violations
and0 green-palette failures. Actual Map161 grass RGB(37,121,67) went from
old(106,66,48) to new(36,104,53) in the original-source swatch calculation.
Night surfaces retain a restrained cool cue. Raw reports/art stay outside Git.

Browser visual QA used original Map161 before/after at the same camera plus
Spore Forest38, Fuming Forest126, Snowy Road331 and night Town5. Green ground,
source leaf colours, mushroom colours, neutral snow and readable night buildings
were inspected; captures are private ignored previews. Actors were paused and
saves isolated. This is not a physical headset or complete story playthrough.
555 JavaScript regressions, ESLint, production build, Ruff and8 packaging tests
passed locally. New regressions cover palette preservation, malformed bounds,
real map/common-event/child execution, wait duration, cinematic map reset,
battle ownership and real co-op screen transport.

## Public project presentation

The user requested the original fan-mod notice, free-distribution/streaming terms
and original gameplay video on the main README, followed by an upstream PR with
sample screenshots. Keep original-author credit and the actual LICENSE intact;
the original video must not be presented as footage of every fork improvement.
The selected, labelled application renders in docs/screenshots are authorized
for public documentation. They are excluded by the release allowlist.
Do not publish private audit reports, review controls, original asset files,
game data or saves. Screenshot character values are test scene state, not proof
of normal progression. Keep detailed developer change inventories in PRs or this
file; the main README remains player-focused.

### Correct upstream comparison

The user challenged the red/green pair and explicitly requested real upstream
versus fork images, a real source diff, and a PR edit. That pair rendered the
fork twice while toggling raw/adapted map tone. Upstream d39c2af actually resets
screen tone to zero on map entry; do not present the fork's raw-tone render as
an upstream baseline. The misleading pair and older standalone HUD/menu samples
were replaced by six actual paired captures; one labelled old launcher sample
remains. No runtime changes accompany this correction.

The private runner serves all60 hash-verified original ZIP app files unmodified
and the actual production fork bundle in separate localhost origins, sharing
the same isolated game-data backend. It adds identical private HTML capture
controls only: pause actor logic, teleport to matching tiles, set yaw0/pitch.12,
open/close the normal menu, capture. Rendering/material/light/tone APIs are not
overridden. Both screenshots are1280x720 and have equal local camera positions
and rotations; terrain determines the rig's world height independently.
Pairs cover Map161 tile26,50 and Map101 tile22,23 (HUD/main menu).
All upstream files remained byte-identical after capture.

The public runtime diff compares literal upstream ZIP JS entries against fork
786bdba, with moved filenames matched and line endings normalized. It includes
actual import-path changes and35 new modules. The separate summary ignores
relative JS import moves:48 original modules retained,20 unchanged,28 modified,
0 missing, +2443/-620 lines in modified originals. Preserve attribution for
the inherited20 unchanged runtime modules. Diff review artifacts contain mod
source only; original game data, raw audit inputs and capture controls stay
private. Fork runtime bundle SHA256 for these captures:
b890a0e41b35a72792c872c4d1cc0a465fa038ab21e1628cdcd83526b2e21941.

### Saved-frame verification

The first comparison upload contained five identical black PNGs despite correct
live browser previews. The private capture helper awaited a metadata POST after
rendering and before reading the WebGL canvas; its non-preserved drawing buffer
had already cleared. Snapshot the canvas synchronously immediately after the
render, before any await/network work, then encode/upload that frozen snapshot.
This changes capture timing only, not the renderer or source comparisons.
Inspect every saved PNG itself and verify non-uniform pixels and distinct hashes
before publishing. Metadata, valid PNG dimensions, HTTP200 and matching remote
blob hashes do not establish that the visible image contains the rendered frame.
The PR comparisons should be visible directly, with links to open each PNG.

### Portrait context and supplied launcher capture

The user asked why the player portrait is absent and supplied a launcher image
for the PR. Read-only original Actors.rvdata2 inspection shows actor1 has empty
face_name, character_name !Flame and class13. Direct map captures call newGame
then jump past opening character setup, retaining this placeholder. The HUD and
classic menu use the actual actor's faceName/faceIndex; no unrelated actor face
should be inserted to decorate those comparisons. Label this test-state limit
in the gallery and PR. Existing initialized gameplay portraits are a separate
case; these captures do not verify them.

The user-provided launcher screenshot is authorized for public documentation.
It replaces the older standalone0.2.11 launcher sample and shows installed
0.2.23 with a0.2.25 update available. Keep that version/update caption accurate.
Copy its original PNG without visual edits, verify the published bytes, and
include it as a standalone community screenshot in the upstream PR.

## Original unnamed enemy labels (0.2.26)

The user reported "Enemy157" above the worm-like battler. Read-only installed
Enemies.rvdata2 verification shows157 has empty name/note and battler_name113.
The original Game_Enemy and enemy-selection window use the database name
directly; the custom HP/status script does not supply another name. No name
override exists for this creature. Preserve its intentional blank name; do not
infer a species from the picture, asset identifier, editor troop label or ID.

ActionEnemy.drawBar now omits the debug-ID fallback and the unused title
background when stripEscapes(name).trim() is empty. Health, groggy, status icons,
visibility rules and existing texture lifetimes are unchanged. Keep the same
canvas/texture size to avoid the earlier immutable GPU-storage resize bug.
Named forms retain their actual names; transforming to/from unnamed forms must
clear or restore the title through the existing cache/build lifecycle.
The unused four-language Enemy{id} label entry was removed.

Regressions execute the real enemy build/nameplate/transform path and verify
half-health gauge width, status labels, formatting-only blank names, texture
reuse and named-to-unnamed-to-named transitions. Use synthetic data in shipped
tests; original databases and scripts stay in private read-only audit caches.

Local verification passed557 JavaScript tests, ESLint, Ruff, production build
and8 packaging tests. Private rendered QA placed the real installed enemy157
in an isolated test scene at75% HP with original Sleep/Poison icons. Its title
is absent while both gauges/effects remain visible. The saved PNG was opened
and inspected; it is not a claim that this creature normally spawns in that room.

The previous0.2.26 source comparison used runtime commit5788b62:
48 original modules,20 unchanged after import moves,28 modified,35 new,0 missing;
2542 added/646 removed lines in modified originals after import normalization.
Existing six comparison images remain explicitly labelled0.2.25.

## Repeated event choices and picture ownership (0.2.26)

The reported Victoria meter is driven by original Troop213 and common events
182/183/301. Its variable86 starts at0; authored actions add1 or2 and select
discrete picture stages below5, from5 through9, and at10 or above. It is not a
mouse-tapping meter. Preserve the original choices, conditions and numeric gates;
do not automatically award relationship progress or add an invented input loop.

The port retained merged-choice results after using them. Jump to Label could
therefore revisit command102 and silently reuse an old answer. The first choice
block now discards its already-applied result; each later merged block consumes
its result once. New visits rebuild visible/enabled rows and ask the player again.

Original Game_Interpreter routes picture commands to Game_Troop.screen in battle
and Game_Map.screen otherwise. Game_Troop.clear clears its screen; Troop213 has
no Erase Picture commands and relies on that ownership. The port's single global
picture map leaked the meter into exploration. Battle buckets now isolate picture
IDs, including child common events, and are released on battle end or combat
reset. Map pictures survive. Stale commands and asynchronous image loads cannot
restore an ended scope. Preserve the existing stage-play routing for its owner.

Co-op's current picture messages have only map picture IDs, without a battle
namespace. Do not pass battle-scoped show/move/erase into that map transport:
it would read or delete an unrelated map picture with the same number. Ordinary
map picture transport stays unchanged. Bind enemy skill common events to their
specific battle so overlapping or later fights cannot steal a delayed command.

Use neutral synthetic text/images and command sequences for public regressions.
Keep original event data and scene artwork in private read-only caches; do not
publish them or include explicit scene playback in visual QA. Tests cover repeat
choices, merged/cancel/visibility mapping, staged numeric progress, overlapping
picture IDs, delayed image loads, child ownership and combat cleanup.

The combined0.2.26 source passes585 JavaScript regressions, ESLint, Ruff,
production build,8 packaging tests and7 Python protocol tests locally. Choice
regressions reproduced6 failures before the fix; scope regressions also caught
reset-before-first-picture and completed-but-retained battle owners. Validation
uses original numeric control-flow inspection plus neutral fixtures, not a full
scene or physical-headset playthrough.

## Main-project presentation

At the user's request, the contribution drops self-referential community/fork
notices from README, launcher, installer and player guides. The visible product
name is BLACK SOULS II VR. The original Lobewarms credit, LICENSE, ownership
requirements and free-distribution rules remain. Historical comparison captions
and developer provenance remain accurate; do not relabel old screenshots as new
renders or remove the original license's rules for distributing modified copies.

Player release notes are RELEASE_NOTES.txt and portable outputs are
BLACKSOULS_VR_<version>.zip. Packaging, CI, release publishing and installer
upgrade cleanup must agree on those names. Retain the installer AppId and save
paths so existing installations upgrade correctly; remove only the obsolete
FORK_NOTICE.txt in addition to the two earlier superseded documents. Repository
identity for live updates still comes from the build repository, and README
release/issue links are relative so the same sources work in the main repository.

## Installed-game speaker and area names (0.2.27)

The reported Map276 nameplate was the Japanese direct override for Ghost
Receptionist. The installed English game's name-window script translates it in
show_name_window, after resolving the face/actor name. The port previously read
only NAME_LIST and returned NW名前指定 overrides before those translations.

Read static literal name aliases from that original method without evaluating
Ruby. Keep aliases separate from the face table, preserve script order and
if/elsif precedence, skip comments/interpolation/dynamic assignments, and support
single/double quotes and literal OR branches. The original name-window method
contains167 branches with169 source keys; independent private comparison found
zero missing, extra or incorrect aliases, with all95 face-table entries retained.

UI resolves literal overrides and face labels once when the message opens, so
desktop/VR reflow cannot consume or erase a pending override twice. Apply aliases
before the bounded non-Actor face-table fallback; five actual collision keys
require that priority. The fallback covers the two remaining Polar Bear overrides.
Preserve dynamic actor/custom names and authored garbled-name variants. Unknown
labels retain their installed spelling; this restores the selected game's own
localization rather than translating its entire story into the add-on UI language.
No original translation table, database or scene artwork is shipped in tests.

Co-op recognizes translated names only for speakers already allowlisted by the
guest's installed data; legacy source labels use the same local resolver. Preserve
validated player names, host-text limits and existing event-reference validation.

Player-facing current/loading status, original-save rows, co-op member locations
and exit analysis now use destinationName instead of mapName's editor labels.
Map276's actual display_name is Mystery Maze. Original saves preload their names
without mutating imported contents. Async co-op updates require the same active
session, visible list and item-array identity before changing labels. Internal
mapName remains available for developer tools; do not show editor suffixes/IDs
in the normal current-area status.

Local verification passed602 JavaScript regressions, ESLint, Ruff, production
build and8 packaging tests. The real UI speaker resolver also matched every169
installed alias and the Polar Bear fallback in a private metadata-only audit.
This does not claim a full story or physical-headset playthrough.

The public literal runtime comparison now uses commit78b691e (0.2.27):48 original
modules retained,17 unchanged after import moves,31 modified,35 new,0 missing;
2708 added/671 removed lines in modified originals after import normalization.
The six actual comparison images remain explicitly labelled0.2.25.


## Original material exchanges (0.2.28)

White Crow's original Map152/event35 enables EasyCompose, opens its purchase-only
shop, and resets that switch when the shop closes. Its 21 offers have zero money
prices and item-material requirements. The port previously ignored those notes,
so it displayed zero Souls and granted purchases without paying the material.

Read the original EasyCompose module's SID, Word, Name, Title and NoDraw literals
without executing Ruby. Gate material prices with that authored switch; do not
hardcode the NPC, map, switch or Candy ID into production code. Preserve first
matching tag per note line and last assignment for a repeated kind/ID. Support
item, weapon and armor materials, omitted count1 and both colon forms; unknown
kinds or absent database entries are skipped like the original. Malformed
nonpositive or unsafe material counts block purchases rather than granting goods.

A private read-only audit using real readScripts and exchangeRequirements matched
all22 tagged database objects and all21 White Crow offers, with zero cost errors.
The installed exchange uses Candy (item49/icon340): Rabbit Key5, Ore Slab10,
Mysterious Shard5 and Goddess' Blood1. No original databases, script bodies,
dialogue, artwork or raw audit reports are tracked or distributed.

Show actual material names/icons, owned balance, per-unit and quantity totals.
Respect NoDraw for all zero-money labels while retaining positive money costs.
Clamp purchases by selected inventory capacity, money and every material. Keep
the existing port's BAG_MAX and99-per-transaction limit; do not alter old saves.
Revalidate a positive integer quantity against all current balances before any
payment or reward. Deduct materials once, then money, then grant purchased goods.

The original storage script aliases Game_Party.item_container, item_number and
max_item_number while its shop mode is active. Both material payment and received
goods therefore use storage in that mode; ordinary mode uses the bag. Equipped
materials are excluded. Respect storage sealing and limits, reset mode on shop
close, and refresh dependent events after stored transactions. Selling retains
its existing half-price money behavior and does not refund exchange materials.

Public regressions use neutral synthetic records and the real UI/GameState/
Interpreter paths for switch activation, scene wait/cancel, quantity selection,
insufficient materials despite ample money, stored materials, mixed material kinds,
combined money/material payment, stale confirmations and ordinary-shop behavior.

Local verification passed648 JavaScript regressions, ESLint, Ruff, production
build,8 packaging tests and7 Python protocol tests. These checks verify the
exchange logic and metadata; they do not claim a complete story or physical
headset playthrough. Existing inventory is not retroactively edited.

The public literal runtime comparison now uses commit74121ea (0.2.28):48 original
modules retained,17 unchanged after import moves,31 modified,36 new,0 missing;
2800 added/685 removed lines in modified originals after import normalization.
The six actual comparison images remain explicitly labelled0.2.25.


## Weapon and skill execution audit (0.2.29)

The user requested another complete effect audit after the material-exchange fix.
Private read-only inventories covered500 weapons,260 armors,999 skills,252
states,200 actors and70 classes. The note census contains32 categories, including
non-angle turn-free markers; installed skill effects use10 ordinary effect codes.
An effect tag's presence in a parser is not evidence its real action path uses it.
Inspect player, enemy, companion, self/support and reflection routes separately.

All640 damage-bearing skills were evaluated across eight isolated profiles:
full resources, low caster HP, low target HP, both at1HP, unequal stats, low MP,
state-dependent branches and scaled variables.5120 raw evaluator calls,5120
public evalFormula calls and5120 computeDamage calls produced no warnings,
exceptions, undefined/nonfinite raw values or invalid damage. This establishes
formula execution for those profiles; it does not prove every effect/event branch
or a full story/headset playthrough. Original formulas, scripts, databases, saves
and private numeric reports must stay outside Git and releases.

### Repaired mechanisms

- Script160's Grit rule had no runtime handler. Read moduleNana's literal
  STATE_KONJO/KONJO_* settings into scripts.guts, without hardcoded state59.
  Apply the configured lethal-hit floor and threshold in shared resource damage;
  MODE true allows a later hit to kill at the floor. MP damage, direct Death
  effects and percentage recovery effects are separate. Preserve drain accounting.
- Friendly/self skills now execute formula HP/MP damage as well as recovery,
  all authored repeats, correct caster MAT/recipient REC/item-user PHA and effect
  array order. Actual skill145 now loses300HP for100MP; skill803 repeats its
  recovery three times. Enemy formula recovery (e.g.15) and MP effect12 work.
- Scope8 support reaches the current living battle party, including companions.
  Ally support delegates to the same effect path; companion buff clocks tick once
  per actor when game logic runs and remain still while paused.
- Legitimate7/9-repeat skills were truncated by5/6/8-hit caps. Use bounded
  usableRepeats and randomTargetCount consistently across thrown items, projectiles,
  bursts, volleys, follow-ups and enemy attack plans. Valid counts remain intact;
  malformed counts are bounded64. Native normal single-target attacks multiply
  item repeats by1+attack-count traits; all/random scopes receive no extra targets
  from that trait. Machine gun plus the extra-attack ring legitimately reaches14;
  repeated replacement attacks plus the ring reach6/9. Costs are paid per action.
- Enemy custom HP conversion now heals its source after a real hit. User TP gain
  uses TCR per landed target/repeat (309 installed skills have tp_gain; no installed
  skills cost TP). Misses and perfect guards grant neither. Recovery inversion
  does not alter native resource drains or direct custom conversion.
- Debuffs include original user LUK, target susceptibility and script185's
  ignore-luck/ignore-rate/forced tags. Preserve the port's existing0.6 incoming
  nonfatal status/debuff factor as an explicit real-time adaptation.
- Direct PC/VR Dodge respects the original Dodge skill seal. Required weapon
  types use the original OR rule, including dual wield, and are rechecked when
  a readied/armed skill fires after equipment changes. Newly granted feature14
  immunity erases already present states on refresh without recursive removeState
  calls or accidentally reviving Death at1HP. Feature13 resistance is distinct.
- Companion hits use shared HP/MP damage/drains and Grit, apply status-only attacks,
  normal-attack state traits, Death/resistance, buff effects, resource conversion,
  hit/evasion, CRI/CEV and MRF. Companion timers do not modify leader timers.
- Native Guard feature62/data1 reduces positive formula damage by2*GRD unless
  script170's ignore-guard rule succeeds. Do not stack it with the existing manual
  enemy guard0.3, player shield or companion timed-guard adapters. Healing and
  independent percentage effects remain outside formula Guard.
- Reflection delegates complete effects once to the original caster, including
  hit/evasion, healing reversal, state removal and buffs. Keep battle death-owner
  identity, auto-revival, resources and no recursive invocation. Script109 SP1
  changes opposite? while magic_reflection is true: the reflected caster remains
  opposed for state susceptibility/LUK even though caster and target are the same.
  Do not incorrectly replace those original checks with friendly-state chances.
- Common-event effect44 belongs to an action before target hit/evasion, once per
  use. Move it out of per-hit handlers; many-target/long-repeat misses still run
  one global event. Separate same-frame uses must not be suppressed by a generic
  timestamp debounce. Preserve explicit battle ownership and map reservations.

### Verification limits

Use neutral synthetic fixtures for public regressions. Private reproductions use
installed numeric metadata only and do not access player saves. Native turn order,
manual gestures, timed recovery, free-turn markers and existing hostile-state
scaling remain real-time adaptations; do not claim turn-for-turn equivalence.
The new checks cover identified execution gaps and every database/formula record
in the bounded audits. They do not establish that every possible equipment,
resistance, story event and multiplayer combination was manually played.

Target skill cancellation (script196) is evaluated after invocation selection;
reflection/counter selection precedes item_apply in the original. Cancel the
recipient's skill effects without refunding action costs or suppressing global
events. Items with the same numeric ID are unaffected. Actual installed
cancellation IDs are friendly skills; hostile-path tests establish generic
source-rule support rather than claiming an installed offensive example.

The final reachability audit found skills33/34 learned by the initial actor's
class and skill34 in enemy292's actions. Revival scopes9/10 must select dead
current-party/troop members (first/all), never heal a living caster by default.
Do not spend player skill costs when there is no eligible recipient. Reuse the
existing reviveEnemy lifecycle and the same troop entry; rewards are finalized
once per unique defeated entry at battle end. Scope9/10 selection is separate
from direct automatic revival, whose source break, immunity and timer handling
also apply to companions. New logic never edits old player saves retroactively.

Final local verification passed753 JavaScript regressions (105 added for this
release), ESLint, Ruff, the production build,8 packaging tests and7 Python
protocol tests. Targeted suites reproduce the repaired paths with synthetic
records, including real action/Interpreter/companion lifecycle and battle-end
reward handling. Preserve the audited distinction between passing formula
profiles, passing mechanic regressions, and unperformed full story/headset runs.

The public literal runtime comparison now uses commit9a69f17 (0.2.29):48 original
modules retained,16 unchanged after import moves,32 modified,37 new,0 missing;
3203 added/808 removed lines in modified originals after import normalization.
The six actual comparison images remain explicitly labelled0.2.25.

## Weapon-triggered Break lifecycle (0.2.30)

King Club's normal-attack state 7 trait reached addEnemyState, which could put an
acting enemy into recover for 0.4 seconds. enemyRestricted deliberately excludes
Break states 7/8 because their AI restriction belongs to the stagger lifecycle.
Consequently the enemy could chase/attack while its Hard Break state was still
active. The normal-attack trait path now calls breakEnemy for states 7/8 after the
same stateEffectChance roll. This preserves native susceptibility, immunity and
LUK, drops the current action marker, enters stagger for 3.2/2.2 seconds, and lets
the existing AI clear Break at the end. Other attack states retain addEnemyState.
Do not replace the native proc roll with the manual weapon-break roll or change
the existing explicit-Break damage adapters as part of this lifecycle repair.

Five synthetic regressions exercise the actual shared player/companion path,
marker cleanup and enemy AI expiry, accuracy and native chance boundaries,
Stun 60%/susceptibility/immunity, and the granted critical-buff skill. The original
Hard Break state itself makes Stun immune, so a successful Hard Break suppresses
the separate Stun effect on that hit. Combat Rush is an active battle-only skill,
costs 4 MP, and grants 30 percentage points CRI; equipping the club alone does not
apply its buff. Existing real-time buff/cooldown timing remains unchanged.
Original database records and the independent pre-fix reproduction remain in
private tooling; public fixtures contain neutral synthetic records. These are
mechanic regressions, not a claim of physical-headset or full-story playtesting.

Local verification passed 758 JavaScript regressions, ESLint, Ruff, the production
build, 8 packaging tests and 7 Python protocol tests.

The literal upstream runtime comparison now uses commit 39953da (0.2.30):
48 original modules retained, 16 unchanged after import moves, 32 modified,
37 new, 0 missing; 3,206 added/808 removed lines in modified originals after
import normalization. Actual comparison images remain labelled 0.2.25.

## Authored creature battlebacks and enemy artwork (0.2.31)

God's Odd Fish has an intentionally empty battler_name. All 16 directly authored
encounters select its original transparent creature artwork with command 283
before starting the troop. The port discarded that command outside the theater
and fabricated a red plane for any null texture. Original Cache.load_bitmap
returns a transparent empty_bitmap for empty filenames; no replacement image is
implied. Bellman, Infinite Food and a Winterbell phase use the same backdrop-art
mechanism. Reuse the installed files; never ship the source images or guess art
from translated creature names.

GameMap retains both current battleback layers and resets them to the new map's
specified defaults on load. An event root captures its own change for the next
battle; the battle stores a separate snapshot. Troop/common-event changes address
their actual live owner through battleOf. Ended owners cannot alter another fight.
The original engine has one fight and map-wide battleback settings; this port can
run several fights. As an explicit concurrency adaptation, live troop changes
stay on their battle and do not seed future unrelated encounters. Independent
map events prepare future artwork without replacing an active theater backdrop.
A troop's sole initially visible member is eligible for a backdrop body, including
a later blank transformation; subsequent hidden-minion appearances do not change
that original eligibility. Two-body mount encounters remain on their existing
shared-art path. Only blank battlers may reuse a nonempty authored image with at
least 1% fully transparent pixels and some alpha above the existing alpha-test
threshold. Opaque scenery and empty images are never creature bodies. Both layer
folders remain distinct. A validated backdrop phase takes precedence over generic
sky inheritance; genuine aerial forms retain their previous art/sky behavior.
The theater's explicit body overrides retain priority.

Material visibility hides empty or failed bodies without hiding the battle,
nameplate or hit dimensions, and survives unpair/revival/color/opacity animation.
Failed texture promises are evicted, including stage pieces, so later requests
can retry. Shared successful textures remain cached. Each asynchronous body build
captures a generation and group identity; remove, same-ID revival and A-to-B-to-A
transformations invalidate older continuations before they allocate a body.
Optional co-op art metadata preserves the legacy 15/17-field tuples and validates
bounded names against the recipient's fixed local battleback folders. Same-ID art
changes rebuild once; legacy omitted metadata clears stale overrides. Deferred
loads cannot resurrect art from an older snapshot.

Private read-only audit covered 601 enemy records: 78 empty battler names, with
4 initial production controllers, 1 debug-only controller and 4 transform-only
forms among static troop/map references. Of 413 distinct nonempty battler names,
412 resolve; the sole missing installed image belongs to a record without static
initial/transform encounter references. All five creature backdrop variants were
verified from the installed assets. Private actual-event reproduction exercised
Map11 event32 command283/301 and troop331 through the real interpreter and combat
constructor: one visible original 700x500 texture, alive controller, sky=false.
It used a CPU canvas adapter and original read-only bytes, not GPU/headset play.
Original databases, images, numeric audits and temporary review controls stay
outside Git and release allowlists. Public regressions use neutral synthetic art.

Local JavaScript verification passed 784 regressions, including 26 new cases for
blank/art-backed bodies, retry caches, stale generations, live ownership,
transformations, minions, mounts and real guest rendering/network validation.

ESLint, Ruff, production build, 8 packaging tests and 7 Python protocol tests
also passed locally for the enemy-artwork update.

The literal source comparison now uses runtime a9b6649 (0.2.31): 48 original
modules retained, 15 unchanged after import moves, 33 modified, 38 new, 0 missing;
3,305 added/822 removed lines in modified originals after import normalization.
The actual screenshot comparisons remain labelled 0.2.25.

## Desktop Break readiness feedback (0.2.32)

The held-Break glow was updated only inside updatePlayerAttack's VR branch.
Desktop pressBreak supplied controller haptics and no visible readiness cue.
Move the cue into the common combat frame after weapon pose/glow updates, so
both desktop and VR receive it and paused frames can hide stale feedback.
Use weaponSeg's rendered tip: PC visualLength includes viewmodel scaling while
the physical/VR hit segment and combat reach retain their existing lengths.
Desktop uses a smaller peripheral glow; VR retains its prior size. Hide the cue
when paused, dead, disarmed, restrained, spectating, adjusting a grip or holding
another action/item, when the weapon is invisible/detached/missing, and on reset.
The original breakArmed result controls cooldowns and quick-slot arm expiry.

Seven new synthetic regressions run real common combat frames, actual Input
F/middle-mouse holds and releases, quick-slot arming/expiry, visible tip transforms,
pause and hand transitions, plus real click/release Break swing dispatch. All
seven failed against the unchanged prior runtime using private test tooling and
pass with the repair. Holding the modifier alone still creates no attack or hit.
Control guides in all four supported languages explain the ready glow and held
modifier. No Break proc rates, costs, manual input rules or original assets are
changed by this presentation repair. No GPU/headset playtest is claimed.

Local verification passed 791 JavaScript regressions, ESLint, Ruff, production
build, 8 packaging tests and 7 Python protocol tests.

The literal source comparison now uses runtime dea954d (0.2.32): 48 original
modules retained, 15 unchanged after import moves, 33 modified, 38 new, 0 missing;
3,316 added/826 removed lines in modified originals after import normalization.
Actual comparison images remain labelled 0.2.25.

## Dialogue camera and native dungeon counter (0.2.33)

Desktop conversation introductions use the initiating main event, map identity and
interpreter execution, not a nearby name match. Turn smoothly for 0.38 seconds
toward the visible standing sprite's upper body, respecting displaced sprites,
looping maps, transparent margins and rig transforms. Pending sheets use the
existing layMode classifier. Skip invisible/floor props, distant events and
unowned narration. Manual motion or right-drag immediately cancels the turn;
later pages and common-event children never recenter it. Ending/replacing an
execution, transfers, death, menus, focus loss and VR discard it. VR head pose
is never changed by this feature.

Desktop dialogue keeps its cursor for choices. An unlocked, canvas-origin right
drag feeds the existing finite/spike-filtered mouse look, suppressing pointer
hover/confirm and gameplay mouse buttons. Leave, blur, text input, closing UI and
view transitions flush held actions. A normal release retains accepted motion
until endFrame so a quick drag/release still takes precedence over autofocus.
The message footer and all four controls guides describe this interaction.

The installed script142 module W_REGULAR configures the original persistent
Layer indicator: map enabled by switch859, selector variable0, row variable119
and item switch859 with native label color16. Read static literal configuration
without executing Ruby; selectors, labels, suffixes, colors, icons and scene
flags remain installed data. Unsupported replacements fail closed. The added
panel is independent of the minimap toggle, below the desktop mini or adjacent
to the wrist health panel. Hide it through dialogue/menu/death/transfers/title
and honor the original battle-window settings. Do not guess membership from map
names or reset/clamp the saved counter. CE276 increments119 on floor advance;
depth117 is separate progression, incremented with difficulty60 by CE284, and
shown in original resume/boss text, not a persistent W_REGULAR row.

The right-hand Space-Time route deliberately calls CE266 to unequip actors1..10
before storing their bag counts, CE267 to remove the stored bag, and starts a
temporary actor11. CE269 death and CE288 allowed exit restore counts through268
and restore the original actor without re-equipping slots. An isolated read-only
actual-command inventory replay covered30 equipped copies and31 stored entries:
both paths returned every original item to the bag with no quantity differences,
errors or warnings. This is inventory/control replay, not a full story run.
Preserve that native rule; no auto re-equip or item duplication workaround added.
Public inventory regressions use neutral synthetic event sequences only.

Local verification passed835 JavaScript regressions (44 new:10 camera,13 drag
input,14 native counter,3 full-UI integration,4 inventory), ESLint, Ruff,
production build,8 packaging tests and7 Python protocol tests. Tests exercise
actual Input/Player/UI/Interpreter paths with synthetic data and canvas adapters;
no GPU screenshot or physical-headset playtest is claimed.
