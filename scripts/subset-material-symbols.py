"""Refresh the local symbol font from the two pinned Google source files."""
import hashlib
import json
from pathlib import Path
import re
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont


def checked_file(argument, expected):
    path = Path(argument)
    if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
        raise ValueError(f"Unexpected upstream file: {path.name}")
    return path


if len(sys.argv) != 3:
    raise SystemExit("Usage: python scripts/subset-material-symbols.py FONT.ttf FONT.codepoints")

source_font = checked_file(sys.argv[1], "7e74e36533ccee12c2b81e75bfcf3ccf123d3bb7e7e46d65d94445f23db0c97c")
source_map = checked_file(sys.argv[2], "a7404d9e5a1b63f496cf05ace45d386075886b5a7f123fba9f29527cb6006fde")
root = Path(__file__).resolve().parents[1]
target = root / "apps/web/src/assets/material-symbols"
catalog = {name: int(code, 16) for name, code in (line.split() for line in source_map.read_text().splitlines())}
words = {"help_outline"}
for base in ("apps/web/src", "packages/shared/src"):
    for path in (root / base).rglob("*"):
        if path.suffix in {".ts", ".tsx", ".js", ".jsx", ".css"} and "test" not in path.parts:
            words.update(re.findall(r"\b[a-z0-9_]+\b", path.read_text(encoding="utf-8")))
names = sorted(words.intersection(catalog))
options = subset.Options()
options.layout_closure = False
options.layout_features = ["liga", "rlig"]
options.name_IDs = ["*"]
options.name_languages = ["*"]
font = TTFont(source_font, recalcTimestamp=False)
subsetter = subset.Subsetter(options=options)
# The text characters form the ligatures, and the selected codepoints retain their output glyphs.
subsetter.populate(unicodes={catalog[name] for name in names} | set(range(48, 58)) | set(range(97, 123)) | {32, 95})
subsetter.subset(font)
font = instantiateVariableFont(font, {"opsz": 24, "wght": 400, "GRAD": 0}, inplace=True)
font.flavor = "woff"
license_text = (target / "LICENSE.txt").read_text(encoding="utf-8")
font["name"].setName("Subset and axis instance for ShippingCo. Source copyright Google LLC. " + license_text, 13, 3, 1, 0x409)
font["name"].setName("https://www.apache.org/licenses/LICENSE-2.0", 14, 3, 1, 0x409)
font.save(target / "rounded.woff")
(target / "names.json").write_bytes((json.dumps(names, indent=2) + "\n").encode())
print(f"Bundled {len(names)} icons")
