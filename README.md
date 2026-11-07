# qPCR Reader for QuantStudio

A browser app for reading Applied Biosystems QuantStudio runs (built and tested with QuantStudio 5 files from Design & Analysis v1.6).

**Your data never leaves your computer.** Files are opened and analyzed entirely inside your browser; nothing is uploaded, including when you use the hosted version.

## Use it

- **Online:** open the GitHub Pages address for this repository (Settings → Pages shows it), then drop in one or more run files.
- **Install as an app:** in Chrome or Edge, click the install icon at the right end of the address bar; in Safari (macOS 14+), choose File → Add to Dock. You get a desktop/Dock icon and a standalone window, it works offline after the first visit, and it updates itself when a new version is published.
- **Fully offline:** download `index.html` and open it in a browser. It is a single self-contained file.

## Supported files

- `.eds` (analyzed and saved in QuantStudio) — includes run method and multicomponent (FAM/ROX) data
- Exported results `.xls`, `.xlsx` or `.ods` containing *Amplification Data*, *Sample Setup* and *Results* (optionally *Multicomponent Data* or *Raw Data*)

## Features

- Plate layout with well selection (wells, rows, columns), exclusion and QC highlighting
- Amplification (ΔRn), Rn and multicomponent (raw FAM and ROX) plots; log/linear; color by target or sample
- Cts recalculated at a shared threshold or per-target thresholds; instrument or fixed-cycle baseline
- QC flags modeled on QuantStudio: NOAMP, AMPNC, BADROX, DRNMIN, HIGHSD, outlier replicates
- ΔCt, ΔΔCt and fold change against matched controls, with bar charts and error bars
- Multi-plate comparison: run QC table with per-plate calibrator, ΔCt across plates, overlaid curves
- CSV and PNG exports

Fold change assumes 100% amplification efficiency (2^ΔΔCt).

## Develop

Sources are in `src/` (`core.js` parsing and analysis, `app2.js` interface, `template.html` page). Rebuild the single-file app after editing:

```bash
python3 src/build.py
```

When releasing, bump `VERSION` in `sw.js` so installed copies pick up the new files.

## Third-party libraries

Bundled into `index.html`: JSZip 3.10.1 (MIT or GPLv3), SheetJS Community Edition 0.18.5 (Apache-2.0), Chart.js 4.4.1 (MIT). See `THIRD_PARTY_NOTICES.md`.

QuantStudio is a trademark of Thermo Fisher Scientific. This project is not affiliated with or endorsed by Thermo Fisher Scientific.
