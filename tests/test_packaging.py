import importlib.util
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('package_release', ROOT / 'scripts' / 'package_release.py')
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
            for name in ['BlacksoulsVR.exe', 'coop_server.py', 'app/src/main.js', 'LICENSE',
                         'FORK_NOTICE.txt', 'app/vendor/three/LICENSE', 'app/vendor/webxr-hands/LICENSE.md']:
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
                    if name.endswith('app/src/main.js'):
                        data += b'\n// changed\n'
                    target.writestr(name, data)
            with self.assertRaisesRegex(ValueError, 'Checksum mismatch'):
                package.verify(modified)

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
