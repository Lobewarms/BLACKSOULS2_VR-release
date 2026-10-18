"""Build a deterministic, explicitly allowlisted mod ZIP; never include game data or saves."""
import argparse
import hashlib
import json
import re
import subprocess
import zipfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
PREFIX = 'BLACKSOULS_VR/'
MANIFEST = PREFIX + 'MANIFEST.json'


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def safe_relative(name):
    path = PurePosixPath(name)
    return (not path.is_absolute() and '..' not in path.parts and '\\' not in name
            and ':' not in name and name.startswith(PREFIX))


def collect(root=ROOT):
    upstream = json.loads((root / 'upstream.json').read_text(encoding='utf-8'))
    names = json.loads((root / 'distribution.json').read_text(encoding='utf-8'))['files']
    if len(names) != len(set(names)):
        raise ValueError('Duplicate distribution entry')
    payload = {}
    for name in names:
        if not safe_relative(name):
            raise ValueError(f'Unsafe distribution path: {name}')
        source = root / name
        if source.is_symlink() or not source.resolve().is_relative_to((root / 'BLACKSOULS_VR').resolve()):
            raise ValueError(f'Non-local distribution file: {name}')
        if any(p.lower() in {'saves', 'data', 'graphics', 'audio'} for p in PurePosixPath(name).parts):
            raise ValueError(f'Game data or save directory in distribution: {name}')
        if source.name.lower() in {'game.exe', 'game.rgss3a', 'coop_server.json'}:
            raise ValueError(f'Game or local configuration file in distribution: {name}')
        payload[name] = source.read_bytes()
    launcher = PREFIX + 'BlacksoulsVR.exe'
    if sha256(payload[launcher]) != upstream['launcher_sha256']:
        raise ValueError('Launcher differs from the documented upstream binary')
    for filename, target in [('LICENSE', 'LICENSE'), ('FORK_NOTICE.txt', 'FORK_NOTICE.txt'),
                             ('upstream.json', 'upstream.json'), ('README.md', 'FORK_README.md')]:
        payload[PREFIX + target] = (root / filename).read_bytes()
    for license_file in ['app/vendor/three/LICENSE', 'app/vendor/webxr-hands/LICENSE.md']:
        if PREFIX + license_file not in payload:
            raise ValueError(f'Missing third-party license: {license_file}')
    return payload


def build(version, output, root=ROOT):
    if not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?', version):
        raise ValueError('Release version must be major.minor.patch with an optional prerelease')
    expected = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
    if version != expected:
        raise ValueError(f'Release version {version} differs from package.json {expected}')
    payload = collect(root)
    try:
        commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
    except (OSError, subprocess.CalledProcessError):
        commit = 'unknown'
    payload[PREFIX + 'FORK_VERSION.txt'] = (version + '\n').encode()
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
        upstream = json.loads(archive.read(PREFIX + 'upstream.json'))
        if sha256(archive.read(PREFIX + 'BlacksoulsVR.exe')) != upstream['launcher_sha256']:
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
        print(f'Verified {args.verify}: {manifest["version"]}, {len(manifest["files"])} files')
    else:
        version = args.version or json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
        print(build(version, args.output or ROOT / 'dist' / f'BLACKSOULS_VR_fork_{version}.zip'))


if __name__ == '__main__':
    main()
