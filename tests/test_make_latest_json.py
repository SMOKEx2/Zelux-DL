import json
import pathlib
import subprocess
import sys
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "make-latest-json.py"
PLATFORM_BUNDLES = {
    "windows-x86_64": "ZeluxDL_2.0.3_x64-setup.exe",
    "darwin-aarch64": "ZeluxDL_2.0.3_aarch64.app.tar.gz",
    "darwin-x86_64": "ZeluxDL_2.0.3_x64.app.tar.gz",
    "linux-x86_64": "ZeluxDL_2.0.3_amd64.AppImage",
}


class MakeLatestJsonTests(unittest.TestCase):
    def run_manifest(self, missing_signature=None, empty_signature=None):
        with tempfile.TemporaryDirectory() as temp:
            artifacts = pathlib.Path(temp) / "artifacts"
            artifacts.mkdir()
            for platform, name in PLATFORM_BUNDLES.items():
                bundle = artifacts / platform / name
                bundle.parent.mkdir()
                bundle.write_bytes(b"artifact")
                if platform != missing_signature:
                    signature = "" if platform == empty_signature else "signature"
                    bundle.with_name(bundle.name + ".sig").write_text(signature, encoding="utf-8")
            notes = pathlib.Path(temp) / "notes.md"
            notes.write_text("## What's new\n\n- Test release\n", encoding="utf-8")
            return subprocess.run(
                [sys.executable, str(SCRIPT), str(artifacts), "v2.0.3", str(notes)],
                text=True,
                capture_output=True,
                check=False,
            )

    def test_manifest_includes_all_supported_platforms(self):
        result = self.run_manifest()
        self.assertEqual(result.returncode, 0, result.stderr)
        manifest = json.loads(result.stdout)
        self.assertEqual(set(manifest["platforms"]), set(PLATFORM_BUNDLES))

    def test_missing_platform_signature_fails_instead_of_publishing_partial_manifest(self):
        result = self.run_manifest(missing_signature="windows-x86_64")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("windows-x86_64", result.stderr)

    def test_empty_signature_fails_instead_of_publishing_invalid_manifest(self):
        result = self.run_manifest(empty_signature="darwin-x86_64")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("darwin-x86_64", result.stderr)


if __name__ == "__main__":
    unittest.main()
