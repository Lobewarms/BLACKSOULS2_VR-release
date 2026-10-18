# BLACK SOULS II VR - modified community fork

[![CI](https://github.com/dimasma0305/BLACKSOULS2_VR-release/actions/workflows/ci.yml/badge.svg)](https://github.com/dimasma0305/BLACKSOULS2_VR-release/actions/workflows/ci.yml)
[![Release](https://github.com/dimasma0305/BLACKSOULS2_VR-release/actions/workflows/release.yml/badge.svg)](https://github.com/dimasma0305/BLACKSOULS2_VR-release/actions/workflows/release.yml)

**This is a modified fork, not an original Lobewarms release.**
Original: [Lobewarms/BLACKSOULS2_VR-release](https://github.com/Lobewarms/BLACKSOULS2_VR-release).
Imported upstream version: **2026.10.16-13**. Fork version: **0.1.0**.

An unofficial first-person PCVR mod for BLACK SOULS II, including Meta Quest through
Quest Link, Air Link or Virtual Desktop. You must provide your own original game.
No game files or saves are included. See [LICENSE](LICENSE) and [FORK_NOTICE.txt](FORK_NOTICE.txt).

## Download and play

1. Open this fork's [Releases](https://github.com/dimasma0305/BLACKSOULS2_VR-release/releases).
2. Download **BLACKSOULS_VR_fork_VERSION.zip**, not GitHub's automatic "Source code" archive.
3. Unzip outside your original game folder. Run `BLACKSOULS_VR/BlacksoulsVR.exe` on Windows.
4. Choose the original game folder and launch. Connect your headset and select **ENTER VR**.

The ZIP includes the original multilingual guides, fork attribution, licenses,
upstream provenance and a per-file checksum manifest. The companion `.sha256`
checks the whole download. See the [English guide](BLACKSOULS_VR/README_en.txt)
and [controls](BLACKSOULS_VR/CONTROLS_en.txt); Korean, Japanese and Chinese guides are beside them.

The launcher is an **unchanged upstream prebuilt executable**. Its source was not
published in the upstream archive, so CI verifies its SHA-256 instead of compiling it.
Its updater may offer the original upstream version and replace fork files;
get fork updates from this fork's Releases page. `version.json` and `app/version.txt`
retain the upstream format/version; `package.json` is the fork's release version.

## Source layout

| Path | Purpose |
| --- | --- |
| `BLACKSOULS_VR/app/src/` | Editable browser JavaScript modules |
| `BLACKSOULS_VR/app/vendor/` | Bundled three.js and WebXR hands, with licenses |
| `BLACKSOULS_VR/coop_server.py` | Python co-op server; no runtime pip dependencies |
| `BLACKSOULS_VR/BlacksoulsVR.exe` | Upstream Windows launcher binary |
| `tests/` | Marshal reader, co-op protocol and packaging regression tests |
| `scripts/` | Browser import checks and deterministic release packaging |
| `distribution.json` | Explicit allowlist of files included in releases |
| `upstream.json` | Imported commit, archive digest and launcher digest |
| `UPSTREAM_README.md` | Preserved original repository README |

The checked-in ZIP is replaced by its unpacked contents. Generated ZIPs go to
`dist/` and GitHub Releases rather than Git history. Existing runtime paths are
preserved so the launcher can still find the application and co-op server.

## Development checks

Use **Node.js 24** and **Python 3.13**. From the repository root:

```sh
npm ci --ignore-scripts
python -m pip install -r requirements-dev.txt
npm run lint
npm run check:imports
npm test
python -m ruff check .
python -m unittest discover -s tests -p "test_*.py" -v
python scripts/package_release.py
```

No original game assets, headset, server connection or launcher execution are
needed for these checks. Lint covers first-party code; vendor code stays unchanged.
Tests exercise the real Marshal reader and co-op parser using synthetic data and
in-memory streams. Packaging tests check repeatability, checksums and required files.
These checks do **not** verify every game event, headset rendering or launcher safety.
Runtime changes still need a Windows/PCVR playtest with your own game copy.

## CI and releases

**CI** runs on `main` pushes, pull requests, manual dispatch and reusable calls.
Both **Ubuntu and Windows** run lint, browser import checks, JavaScript tests,
Python protocol/packaging tests, then build ZIPs and SHA-256 checksums. Downloadable
run artifacts are retained for 14 days.

**Release** runs on `v*` tags. It requires the full CI matrix to pass before publishing
a GitHub Release with the ZIP and checksum. Tags must match `package.json` exactly,
prefixed with `v`. Existing releases are never silently overwritten.

To publish the next version:

1. Run `npm version 0.1.1 --no-git-tag-version` (substitute the desired version).
   Update the fork version in this README.
2. Commit and push to `main`; wait for green CI.
3. Tag that commit and push it:

   ```sh
   git tag v0.1.1
   git push origin v0.1.1
   ```

No personal token is required in repository secrets: publishing uses `GITHUB_TOKEN`.
Checks have read-only repository permissions. Only the release publishing job has
`contents: write`. Actions are pinned to commit SHAs; Dependabot checks Actions,
npm and Python tooling weekly.

## Updating from upstream

Review the new upstream archive and license, then import its runtime files into
`BLACKSOULS_VR/`. Update `upstream.json` with the precise upstream commit, version,
archive SHA-256 and launcher SHA-256. Review `distribution.json` changes explicitly
when runtime files are added or removed. Never include game data, saves, local
server settings or development dependencies. Run checks and a PCVR playtest before
publishing runtime changes.

## Distribution terms

Modified versions must be **free of charge**, credit the original and clearly state
that they are modified. Do not bundle the original game. The upstream [LICENSE](LICENSE)
remains in force. Third-party components retain their own included licenses.
