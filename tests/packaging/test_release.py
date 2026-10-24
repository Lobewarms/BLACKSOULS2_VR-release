import importlib.util
import json
import re
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('package_release', ROOT / 'tooling/release/package_release.py')
package = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package)
VERSION = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']


class PackagingTests(unittest.TestCase):
    def test_steam_worker_is_x86_and_private_runtime_files_are_excluded(self):
        payload = package.collect()
        worker = payload[package.PREFIX + 'SteamAchievements.exe']
        self.assertEqual(worker[:2], b'MZ')
        pe = int.from_bytes(worker[60:64], 'little')
        self.assertEqual(worker[pe:pe + 4], b'PE\0\0')
        self.assertEqual(int.from_bytes(worker[pe + 4:pe + 6], 'little'), 0x14c)
        self.assertFalse(any(Path(name).name.lower() in {'steam-session.json', 'steam_appid.txt',
                                                       'steam_api.dll', 'steam_api64.dll'}
                             for name in payload))

    def test_release_is_reproducible_and_contains_runtime_and_attribution(self):
        with tempfile.TemporaryDirectory() as directory:
            first = package.build(VERSION, Path(directory) / 'a.zip')
            second = package.build(VERSION, Path(directory) / 'b.zip')
            self.assertEqual(first.read_bytes(), second.read_bytes())
            manifest = package.verify(first)
            for name in ['BlacksoulsVR.exe', 'BlacksoulsVR.Engine.exe', 'SteamAchievements.exe', 'coop_server.py', 'app/index.html', 'LICENSE',
                         'RELEASE_NOTES.txt', 'AGENTS.md', 'START_HERE.txt', 'release.json', 'engine-build.json', 'engine-upstream.json', 'app/licenses/three.LICENSE',
                         'app/licenses/webxr-input-profiles-assets.LICENSE.md',
                         'server/blacksouls_vr_coop/server.py', 'server/blacksouls_vr_coop/world_server.py',
                         'world_server.py', 'world_server.cmd', 'app/models/hands/left.glb']:
                self.assertIn(package.PREFIX + name, manifest['files'])
            self.assertFalse(any('/saves/' in name or '/node_modules/' in name for name in manifest['files']))
            self.assertTrue(first.with_name('a.zip.sha256').is_file())

    def test_update_identity_follows_ci_repository_and_packaged_version(self):
        with patch.dict('os.environ', {'GITHUB_REPOSITORY': 'another-owner/another-fork'}):
            with tempfile.TemporaryDirectory() as directory:
                archive = package.build(VERSION, Path(directory) / 'fork.zip')
                with zipfile.ZipFile(archive) as source:
                    identity = json.loads(source.read(package.PREFIX + 'release.json'))
                self.assertEqual(identity, {'schema': 1, 'repository': 'another-owner/another-fork', 'version': VERSION})
        with patch.dict('os.environ', {'GITHUB_REPOSITORY': '../invalid'}):
            with self.assertRaisesRegex(ValueError, 'Invalid GitHub'):
                package.release_identity()

    def test_tampered_release_fails_verification(self):
        with tempfile.TemporaryDirectory() as directory:
            original = package.build(VERSION, Path(directory) / 'original.zip')
            modified = Path(directory) / 'modified.zip'
            with zipfile.ZipFile(original) as source, zipfile.ZipFile(modified, 'w') as target:
                for name in source.namelist():
                    data = source.read(name)
                    if name.endswith('app/index.html'):
                        data += b'\n// changed\n'
                    target.writestr(name, data)
            with self.assertRaisesRegex(ValueError, 'Checksum mismatch'):
                package.verify(modified)

    def test_portable_server_starts_without_installed_package(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = package.build(VERSION, Path(directory) / 'portable.zip')
            with zipfile.ZipFile(archive) as source:
                source.extractall(Path(directory) / 'unpacked')
            launcher = Path(directory) / 'unpacked' / 'BLACKSOULS_VR' / 'coop_server.py'
            # Isolated mode excludes the editable install, user site and working directory.
            result = subprocess.run([sys.executable, '-I', str(launcher), '--help'],
                                    capture_output=True, text=True, check=True, timeout=15)
            self.assertIn('--host-pin', result.stdout)
            self.assertFalse(launcher.with_name('coop_server.json').exists())
            world_launcher = launcher.with_name('world_server.py')
            result = subprocess.run([sys.executable, '-I', str(world_launcher), '--help'],
                                    capture_output=True, text=True, check=True, timeout=15)
            self.assertIn('--admin-pin', result.stdout)
            self.assertIn('--restore', result.stdout)
            self.assertFalse(world_launcher.with_name('world_server.json').exists())

    def test_built_html_points_to_packaged_bundle_and_preserves_runtime_urls(self):
        payload = package.collect()
        html = payload[package.PREFIX + 'app/index.html'].decode('utf-8')
        self.assertNotIn('type="importmap"', html)
        scripts = re.findall(r'<script[^>]+src="([^"]+)"', html)
        self.assertTrue(scripts)
        for source in scripts:
            self.assertFalse(source.startswith(('http:', 'https:')))
            self.assertIn(package.PREFIX + 'app/' + source.removeprefix('./'), payload)
        for name in ['src/maphints.user.json', 'devserver.json', 'version.txt',
                     'models/hands/left.glb', 'models/hands/right.glb']:
            self.assertIn(package.PREFIX + 'app/' + name, payload)

    def test_release_version_must_match_project_version(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                package.build('999.999.999', Path(directory) / 'bad.zip')

    def test_rejects_unsafe_archive_paths(self):
        for name in ['/absolute', '../escape', 'BLACKSOULS_VR/../../escape',
                     'BLACKSOULS_VR/C:escape', 'BLACKSOULS_VR/..\\escape']:
            self.assertFalse(package.safe_relative(name), name)

    def test_source_built_engine_is_bound_to_reviewed_source_and_not_vendor_binary(self):
        pin, build, binary = package.engine_inputs(ROOT)
        payload = package.collect()
        self.assertEqual(payload[package.PREFIX + 'BlacksoulsVR.Engine.exe'], binary)
        self.assertEqual(build['source_tree_sha256'], package.engine_source_digest(pin['source_sha256']))
        self.assertEqual(json.loads(payload[package.PREFIX + 'engine-upstream.json']), pin)
        self.assertNotEqual(binary, (ROOT / 'vendor/launcher/BlacksoulsVR.exe').read_bytes())
        self.assertTrue(binary.startswith(b'MZ'))
        for name, digest in pin['source_sha256'].items():
            canonical = (ROOT / 'apps/engine' / name).read_bytes().replace(b'\\r\\n', b'\\n')
            self.assertEqual(package.sha256(canonical), digest)

    def test_engine_build_rejects_binary_or_source_manifest_substitution(self):
        pin, build, binary = package.engine_inputs(ROOT)
        for key, value in [('upstream_commit', '0' * 40), ('source_tree_sha256', '0' * 64),
                           ('engine_sha256', '0' * 64), ('source_sha256', {})]:
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, 'engine provenance mismatch'):
                package.validate_engine_provenance(pin, {**build, key: value}, binary)
        with self.assertRaisesRegex(ValueError, 'engine provenance mismatch'):
            package.validate_engine_provenance(pin, build, (ROOT / 'vendor/launcher/BlacksoulsVR.exe').read_bytes())

    def test_package_requires_compiled_engine_even_when_legacy_vendor_exists(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'apps/engine').mkdir(parents=True)
            (root / 'vendor/launcher').mkdir(parents=True)
            (root / 'apps/engine/upstream.json').write_bytes((ROOT / 'apps/engine/upstream.json').read_bytes())
            (root / 'vendor/launcher/BlacksoulsVR.exe').write_bytes(b'MZlegacy')
            with self.assertRaisesRegex(ValueError, 'Missing source-built engine'):
                package.engine_inputs(root)

    def test_source_mutation_is_rejected_without_touching_checkout(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'apps/engine').mkdir(parents=True)
            (root / 'apps/launcher/dist').mkdir(parents=True)
            for file in (ROOT / 'apps/engine').glob('*'):
                (root / 'apps/engine' / file.name).write_bytes(file.read_bytes())
            for name in ['BlacksoulsVR.Engine.exe', 'engine-build.json']:
                (root / 'apps/launcher/dist' / name).write_bytes((ROOT / 'apps/launcher/dist' / name).read_bytes())
            source = root / 'apps/engine/BlacksoulsVR.cs'
            source.write_bytes(source.read_bytes() + b'\\n// unexpected edit\\n')
            with self.assertRaisesRegex(ValueError, 'Engine source differs'):
                package.engine_inputs(root)

    def test_forged_package_manifest_cannot_certify_an_unrelated_engine(self):
        with tempfile.TemporaryDirectory() as directory:
            original = package.build(VERSION, Path(directory) / 'original.zip')
            changed = Path(directory) / 'changed.zip'
            with zipfile.ZipFile(original) as archive:
                contents = {name: archive.read(name) for name in archive.namelist()}
            name = package.PREFIX + 'BlacksoulsVR.Engine.exe'
            contents[name] = (ROOT / 'vendor/launcher/BlacksoulsVR.exe').read_bytes()
            manifest = json.loads(contents[package.MANIFEST])
            manifest['files'][name] = package.sha256(contents[name])
            contents[package.MANIFEST] = json.dumps(manifest).encode()
            with zipfile.ZipFile(changed, 'w') as archive:
                for name, body in contents.items():
                    archive.writestr(name, body)
            with self.assertRaisesRegex(ValueError, 'engine provenance mismatch'):
                package.verify(changed)


if __name__ == '__main__':
    unittest.main()
