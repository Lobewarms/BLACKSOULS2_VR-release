import importlib.util
import json
import re
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('package_release', ROOT / 'tooling/release/package_release.py')
package = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package)
VERSION = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']


class PackagingTests(unittest.TestCase):
    def test_release_is_reproducible_and_contains_runtime_and_attribution(self):
        with tempfile.TemporaryDirectory() as directory:
            first = package.build(VERSION, Path(directory) / 'a.zip')
            second = package.build(VERSION, Path(directory) / 'b.zip')
            self.assertEqual(first.read_bytes(), second.read_bytes())
            manifest = package.verify(first)
            for name in ['BlacksoulsVR.exe', 'coop_server.py', 'app/index.html', 'LICENSE',
                         'FORK_NOTICE.txt', 'app/licenses/three.LICENSE',
                         'app/licenses/webxr-input-profiles-assets.LICENSE.md',
                         'server/blacksouls_vr_coop/server.py', 'app/models/hands/left.glb']:
                self.assertIn(package.PREFIX + name, manifest['files'])
            self.assertFalse(any('/saves/' in name or '/node_modules/' in name for name in manifest['files']))
            self.assertTrue(first.with_name('a.zip.sha256').is_file())

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


if __name__ == '__main__':
    unittest.main()
