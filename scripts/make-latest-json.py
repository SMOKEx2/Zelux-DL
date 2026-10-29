"""Build the updater manifest (latest.json) for a release from the signed update bundles.

    python scripts/make-latest-json.py <dir with bundles and .sig files> <tag> <notes.md> > latest.json

Prism's in-app updater reads it from releases/latest/download/latest.json.
"""
import datetime
import json
import os
import pathlib
import sys

src, tag, notes_path = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3]
version = tag.lstrip("v")
repo = os.environ.get("GITHUB_REPOSITORY") or "SMOKEx2/Zelux-DL"
base = os.environ.get("UPDATE_BASE_URL") or f"https://github.com/{repo}/releases/download/{tag}/"

# platform key -> file-name suffix of its update bundle
PLATFORMS = {
    "windows-x86_64": "_x64-setup.exe",
    "darwin-aarch64": "_aarch64.app.tar.gz",
    "darwin-x86_64": "_x64.app.tar.gz",
    "linux-x86_64": "_amd64.AppImage",
}

platforms = {}
for key, suffix in PLATFORMS.items():
    bundle = next((p for p in src.rglob(f"*{suffix}") if p.name.startswith(("ZeluxDL_", "Prism_"))), None)
    if bundle and not (bundle.name.startswith(f"ZeluxDL_{version}_") or bundle.name.startswith(f"Prism_{version}_")):
        # The app would report another version than the manifest and be offered it forever.
        sys.exit(f"{bundle.name} doesn't match tag {tag}: bump the version in tauri.conf.json, Cargo.toml and app/package.json")
    sig = bundle and bundle.with_name(bundle.name + ".sig")
    if not bundle or not sig.exists():
        print(f"warning: no signed bundle for {key}", file=sys.stderr)
        continue
    platforms[key] = {"signature": sig.read_text().strip(), "url": base + bundle.name}

if not platforms:
    sys.exit("no signed update bundles found")
notes = pathlib.Path(notes_path).read_text(encoding="utf-8")
whats_new = notes.split("## What's new", 1)[-1].split("\n## ", 1)[0] if "## What's new" in notes else ""
json.dump(
    {
        "version": version,
        "notes": whats_new.split("\n", 1)[-1].strip(),
        "pub_date": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "platforms": platforms,
    },
    sys.stdout,
    indent=2,
)
