"""Build a deterministic, explicitly allowlisted mod ZIP; never include game data or saves."""
import argparse
import hashlib
import json
import os
import re
import subprocess
import tomllib
import zipfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[2]
PREFIX = 'BLACKSOULS_VR/'
MANIFEST = PREFIX + 'MANIFEST.json'


def release_identity(root=ROOT):
    # Actions supplies the repository of this build, including builds in forks.
    repository = os.environ.get('GITHUB_REPOSITORY')
    if not repository:
        remote = subprocess.check_output(['git', 'remote', 'get-url', 'origin'], cwd=root, text=True).strip()
        match = re.fullmatch(r'(?:https://github\.com/|git@github\.com:)([^/]+/[^/]+?)(?:\.git)?', remote)
        if not match:
            raise ValueError('Cannot determine the GitHub release repository from origin')
        repository = match[1]
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*', repository):
        raise ValueError('Invalid GitHub release repository')
    version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
    return {'schema': 1, 'repository': repository, 'version': version}


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def engine_source_digest(files):
    return sha256(''.join(f'{name}:{digest}\n' for name, digest in sorted(files.items())).encode('utf-8'))


def validate_engine_provenance(pin, build, binary):
    sources = pin.get('source_sha256', {})
    if (pin.get('schema') != 1 or pin.get('normalization') != 'utf8-lf'
            or not re.fullmatch(r'[0-9a-f]{40}', pin.get('commit', ''))
            or set(sources) != {'BlacksoulsVR.cs', 'BuildInfo.cs'}
            or any(not isinstance(digest, str) or not re.fullmatch(r'[0-9a-f]{64}', digest)
                   for digest in sources.values())):
        raise ValueError('Invalid reviewed engine source provenance')
    if (build.get('schema') != 1 or build.get('upstream_commit') != pin['commit']
            or build.get('source_sha256') != sources
            or build.get('source_tree_sha256') != engine_source_digest(sources)
            or build.get('engine_sha256') != sha256(binary)):
        raise ValueError('Source-built engine provenance mismatch')


def engine_inputs(root):
    pin = json.loads((root / 'apps/engine/upstream.json').read_text(encoding='utf-8'))
    output = root / 'apps/launcher/dist'
    if not (output / 'engine-build.json').is_file() or not (output / 'BlacksoulsVR.Engine.exe').is_file():
        raise ValueError('Missing source-built engine. Run tooling/release/build_launcher.ps1 first.')
    build = json.loads((output / 'engine-build.json').read_text(encoding='utf-8'))
    binary = (output / 'BlacksoulsVR.Engine.exe').read_bytes()
    validate_engine_provenance(pin, build, binary)
    for name, digest in pin['source_sha256'].items():
        source = root / 'apps/engine' / name
        if (not source.is_file() or source.is_symlink()
                or sha256(source.read_bytes().replace(b'\r\n', b'\n')) != digest):
            raise ValueError(f'Engine source differs from its reviewed provenance: {name}')
    return pin, build, binary


def safe_relative(name):
    path = PurePosixPath(name)
    return (not path.is_absolute() and '..' not in path.parts and '\\' not in name
            and ':' not in name and name.startswith(PREFIX))


def collect(root=ROOT):
    engine_inputs(root)
    distribution = json.loads((root / 'packaging/distribution.json').read_text(encoding='utf-8'))
    names = dict(distribution['files'])
    for source_dir, target_dir in distribution['trees'].items():
        directory = (root / source_dir).resolve()
        if not directory.is_relative_to(root.resolve()) or not directory.is_dir():
            raise ValueError(f'Missing build directory: {source_dir}. Run npm run build first.')
        for file in directory.rglob('*'):
            if file.is_file() and file.suffix not in {'.pyc', '.pyo'} and '__pycache__' not in file.parts:
                source = file.relative_to(root).as_posix()
                target = (PurePosixPath(target_dir) / file.relative_to(directory).as_posix()).as_posix()
                if source in names or target in names.values():
                    raise ValueError(f'Duplicate distribution entry: {target}')
                names[source] = target
    if len(names.values()) != len(set(names.values())):
        raise ValueError('Duplicate distribution destination')
    payload = {}
    for source_name, destination in names.items():
        name = PREFIX + destination
        if not safe_relative(name):
            raise ValueError(f'Unsafe distribution path: {name}')
        source = root / source_name
        if source.is_symlink() or not source.resolve().is_relative_to(root.resolve()):
            raise ValueError(f'Non-local distribution file: {name}')
        if any(p.lower() in {'saves', 'data', 'graphics', 'audio'} for p in PurePosixPath(name).parts):
            raise ValueError(f'Game data or save directory in distribution: {name}')
        if source.name.lower() in {'game.exe', 'game.rgss3a', 'coop_server.json', 'steam-session.json',
                                   'steam_appid.txt', 'steam_api.dll', 'steam_api64.dll'}:
            raise ValueError(f'Game or local configuration file in distribution: {name}')
        payload[name] = source.read_bytes()
    # Verify the actual mapped files too, so changing the distribution mapping
    # cannot substitute the old vendor binary for the compiled engine.
    validate_engine_provenance(json.loads(payload[PREFIX + 'engine-upstream.json']),
                               json.loads(payload[PREFIX + 'engine-build.json']),
                               payload[PREFIX + 'BlacksoulsVR.Engine.exe'])
    for filename, target in [('LICENSE', 'LICENSE'), ('RELEASE_NOTES.txt', 'RELEASE_NOTES.txt'),
                             ('vendor/launcher/upstream.json', 'upstream.json'),
                             ('AGENTS.md', 'AGENTS.md')]:
        payload[PREFIX + target] = (root / filename).read_bytes()
    for license_file in ['app/licenses/three.LICENSE', 'app/licenses/webxr-input-profiles-assets.LICENSE.md']:
        if PREFIX + license_file not in payload:
            raise ValueError(f'Missing third-party license: {license_file}')
    # A source checkout alone is not a runnable client; require the actual compiled entry.
    if PREFIX + 'app/index.html' not in payload:
        raise ValueError('Missing built browser entry. Run npm run build first.')
    return payload


def build(version, output, root=ROOT):
    if not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?', version):
        raise ValueError('Release version must be major.minor.patch with an optional prerelease')
    expected = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
    if version != expected:
        raise ValueError(f'Release version {version} differs from package.json {expected}')
    client_version = json.loads((root / 'apps/client/package.json').read_text(encoding='utf-8'))['version']
    server_version = tomllib.loads((root / 'packages/coop-server/pyproject.toml').read_text(encoding='utf-8'))['project']['version']
    if client_version != version or server_version != version:
        raise ValueError('Root, client and server versions must agree for a monorepo release')
    payload = collect(root)
    payload[PREFIX + 'release.json'] = (json.dumps(release_identity(root), indent=2, sort_keys=True) + '\n').encode()
    try:
        commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
    except (OSError, subprocess.CalledProcessError):
        commit = 'unknown'
    manifest = {'version': version, 'commit': commit,
                'files': {name: sha256(data) for name, data in sorted(payload.items())}}
    payload[MANIFEST] = (json.dumps(manifest, indent=2, sort_keys=True) + '\n').encode()
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, data in sorted(payload.items()):
            entry = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            entry.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(entry, data, compresslevel=9)
    verify(output)
    checksum = output.with_name(output.name + '.sha256')
    checksum.write_text(f'{sha256(output.read_bytes())}  {output.name}\n', encoding='utf-8')
    return output


def verify(path):
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)) or not all(safe_relative(name) for name in names):
            raise ValueError('Duplicate or unsafe ZIP entry')
        manifest = json.loads(archive.read(MANIFEST))
        expected = manifest['files']
        if set(names) != set(expected) | {MANIFEST}:
            raise ValueError('ZIP inventory does not match its manifest')
        for name, digest in expected.items():
            if sha256(archive.read(name)) != digest:
                raise ValueError(f'Checksum mismatch: {name}')
        if PREFIX + 'release.json' in names:
            identity = json.loads(archive.read(PREFIX + 'release.json'))
            if (identity.get('schema') != 1 or identity.get('version') != manifest['version']
                    or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*', identity.get('repository', ''))):
                raise ValueError('Invalid packaged release identity')
        upstream = json.loads(archive.read(PREFIX + 'upstream.json'))
        # Older releases used the stock launcher directly; newer ones add discovery.
        engine = PREFIX + 'BlacksoulsVR.Engine.exe'
        if engine not in names:
            engine = PREFIX + 'BlacksoulsVR.exe'
        if PREFIX + 'engine-build.json' in names:
            if PREFIX + 'engine-upstream.json' not in names:
                raise ValueError('Missing engine source provenance')
            validate_engine_provenance(json.loads(archive.read(PREFIX + 'engine-upstream.json')),
                                       json.loads(archive.read(PREFIX + 'engine-build.json')),
                                       archive.read(engine))
        elif sha256(archive.read(engine)) != upstream['launcher_sha256']:
            raise ValueError('Launcher provenance mismatch')
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version')
    parser.add_argument('--output', type=Path)
    parser.add_argument('--verify', type=Path)
    args = parser.parse_args()
    if args.verify:
        manifest = verify(args.verify)
        if args.version:
            expected = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
            if manifest['version'] != args.version or args.version != expected:
                raise ValueError('Tag, project version and tested artifact version must agree')
            with zipfile.ZipFile(args.verify) as archive:
                if PREFIX + 'release.json' in archive.namelist():
                    identity = json.loads(archive.read(PREFIX + 'release.json'))
                    if identity != release_identity():
                        raise ValueError('Tested artifact belongs to a different release repository')
        checksum = args.verify.with_name(args.verify.name + '.sha256')
        if checksum.is_file() and checksum.read_text(encoding='utf-8').split()[0] != sha256(args.verify.read_bytes()):
            raise ValueError('Archive SHA-256 does not match its published checksum')
        print(f'Verified {args.verify}: {manifest["version"]}, {len(manifest["files"])} files')
    else:
        version = args.version or json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
        print(build(version, args.output or ROOT / 'dist' / f'BLACKSOULS_VR_{version}.zip'))


if __name__ == '__main__':
    main()
