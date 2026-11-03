# Material Symbols Rounded

ShippingCo bundles Google's Material Symbols Rounded under the Apache License 2.0.
The local WOFF retains the filled and outlined variants. The other axes use the
same settings as the app stylesheet, with optical size 24, weight 400 and grade 0.
The font contains the license and upstream copyright notice. A separate copy
is included in [LICENSE.txt](LICENSE.txt).

The source font and codepoint catalogue come from
[Google's pinned Material Symbols repository](https://github.com/google/material-design-icons/tree/10ecc14790612ca8fd164e3f4ffe9c16fc50d5b7/variablefont).
To refresh after adding an icon, run the following maintenance command using
a Python environment with FontTools and these two upstream files. The script
checks both input hashes and includes matching identifiers from app and shared
source so icons selected through status and navigation maps are covered.

```sh
python scripts/subset-material-symbols.py 'MaterialSymbolsRounded[FILL,GRAD,opsz,wght].ttf' 'MaterialSymbolsRounded[FILL,GRAD,opsz,wght].codepoints'
```

The production build embeds the WOFF in its single HTML file. Unknown symbol
names use the bundled help icon. The application and its builds use the checked-in
assets directly.
