"""Keep Linux system registration compatible with the shipped host and extension."""
import json
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]


class LinuxNativeManifestTests(unittest.TestCase):
    def test_installer_manifests_match_runtime_identities(self):
        script = (ROOT / "packaging/linux/postinst.sh").read_text()
        runtime = (ROOT / "crates/prism-native-host/src/lib.rs").read_text()
        constants = dict(re.findall(r'pub const (\w+): &str = "([^"]+)";', runtime))
        variables = dict(re.findall(r"^(HOST|CHROME_ID|FIREFOX_ID)=(.+)$", script, re.M))
        self.assertEqual(variables["HOST"], "/usr/bin/" + constants["HOST_BINARY_NAME"])
        self.assertEqual(variables["CHROME_ID"], constants["CHROME_EXTENSION_ID"])
        self.assertEqual(variables["FIREFOX_ID"], constants["FIREFOX_EXTENSION_ID"])
        for template in re.findall(r"cat <<JSON\n(.*?)\nJSON", script, re.S):
            for name, value in variables.items():
                template = template.replace("$" + name, value)
            manifest = json.loads(template)
            self.assertEqual(manifest["name"], constants["HOST_NAME"])
            self.assertEqual(manifest["path"], variables["HOST"])
        for path in ["packaging/linux/postinst.sh", "packaging/linux/prerm.sh"]:
            self.assertIn(constants["HOST_NAME"] + ".json", (ROOT / path).read_text())
            self.assertNotIn("dev.prism.host", (ROOT / path).read_text())


if __name__ == "__main__":
    unittest.main()
