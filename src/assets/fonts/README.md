# Bundled application fonts

These are the existing application families: Inter for Latin, Cairo for Arabic,
Noto Nastaliq Urdu and Noto Sans Bengali for registration routes. Next's local
font loader serves them from this application, with no font download during
build or at runtime. Registration fonts remain scoped to those layouts.

`manifest.json` records the pinned `google/fonts` commit, original file URLs,
source and output SHA-256 hashes, sizes, and variation axes. The complete
upstream TrueType files were converted to WOFF2 with fonttools 4.66.1 and
Brotli 1.2.0; no glyphs or axes were removed. Conversion was checked by reopening
each WOFF2 and comparing its glyph order, character map and axes to its source.
The unmodified SIL Open Font License for each family is in `licenses/`.

To refresh a font, download the source and license from a reviewed pinned
upstream commit, verify its Git blob hash, and compress with `fontTools.ttLib`
(`TTFont`, `flavor = 'woff2'`, preserving the source timestamp). Recheck the
glyphs, scripts, variation axes, licenses and manifest hashes before committing.
Conversion tooling is a development task; no Python package is needed to build
or run the app.
