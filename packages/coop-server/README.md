# Co-op relay server

Install from the repository root with `python -m pip install ./packages/coop-server`,
then run `blacksouls-vr-coop --help` or `python -m blacksouls_vr_coop --help`.

The package uses Python's standard-library `asyncio` networking and retains the
upstream wire protocol. It needs no third-party runtime dependencies.
Configuration defaults to `coop_server.json` in the working directory. Set
`BLACKSOULS_VR_COOP_CONFIG` to choose a different configuration file.

For a persistent community world without a player host, run
`blacksouls-vr-world --help` after installation, or `world_server.py --help`
from the portable distribution. Its default port is 28472. `--dir FOLDER`
(or `BLACKSOULS_VR_WORLD_DIR`) selects the configuration, world and backups
directory; the default is the working directory. `--no-save` keeps the world
in memory. The community admin can enable shared loot; it is off by default.
Chat is relayed without storage, and voice is relayed only to the speaker's
current map. The client starts in listen-only mode and opens a microphone
only after the player selects talk mode.

For development: `python -m pip install -e ./packages/coop-server`.
Tests: `python -m unittest discover -s packages/coop-server/tests -v`.

This is a modified fork of [Lobewarms' original mod](https://github.com/Lobewarms/BLACKSOULS2_VR-release).
The included LICENSE applies. Free distribution only; do not bundle game files.
