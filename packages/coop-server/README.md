# Co-op relay server

Install from the repository root with `python -m pip install ./packages/coop-server`,
then run `blacksouls-vr-coop --help` or `python -m blacksouls_vr_coop --help`.

The package uses Python's standard-library `asyncio` networking and retains the
upstream wire protocol. It needs no third-party runtime dependencies.
Configuration defaults to `coop_server.json` in the working directory. Set
`BLACKSOULS_VR_COOP_CONFIG` to choose a different configuration file.

For development: `python -m pip install -e ./packages/coop-server`.
Tests: `python -m unittest discover -s packages/coop-server/tests -v`.

This is a modified fork of [Lobewarms' original mod](https://github.com/Lobewarms/BLACKSOULS2_VR-release).
The included LICENSE applies. Free distribution only; do not bundle game files.
