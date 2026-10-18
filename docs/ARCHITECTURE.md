# Repository architecture

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
