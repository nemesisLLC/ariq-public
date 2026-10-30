#!/usr/bin/env python3
"""ARIQ Phase 2 validation against independent ground measurements.

Run: .venv/Scripts/python.exe scripts/validate-phase2-soil.py

The only openly obtainable Uzbekistan laboratory soil dataset with texture,
SOC and pH we found is regional, not farm-point, data:

  Measured (lab): Int. J. Environ. Res. Public Health 2022, 19, 8794,
  Table 1 — soil samples from 20 points x 5 depths in Khiva, Kushkupir and
  Shavat districts (Khorezm Region), analysed at the Research Institute of
  Soil Science and Agrochemistry. Values below are the published layer
  means depth-weighted to 0-30 cm to match the Phase 2 grid basis.
  Caveats: published fractions sum to ~105% (as printed; used as printed),
  pH is arithmetically averaged (as published), and the measured mean is a
  district-sample mean — NOT the same population as a whole-region grid
  mean. This checks plausibility and bias, not farm-level accuracy.

Farm-level empirical accuracy CANNOT be verified from openly obtainable
data; no georeferenced Uzbekistan farm soil-test dataset was found.
"""
import base64
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent

# Published Table 1 layer means -> 0-30 cm (equal 10 cm layers).
MEASURED = {
    "sandPct": (24 + 34 + 27) / 3,
    "siltPct": (59 + 52 + 64) / 3,
    "clayPct": (21 + 19 + 14) / 3,
    "socGPerKg": ((0.44 + 0.36 + 0.30) / 3) * 10,  # % -> g/kg
    "ph": (6.21 + 6.18 + 6.19) / 3,
}


def point_in_ring(lon, lat, ring):
    inside = False
    for i in range(len(ring)):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % len(ring)]
        if (y1 > lat) != (y2 > lat) and lon < x1 + (x2 - x1) * (lat - y1) / (y2 - y1):
            inside = not inside
    return inside


def main() -> None:
    grid = json.loads((ROOT / "lib/data-intelligence/soil-grid.json").read_text(encoding="utf-8"))
    regions = json.loads((ROOT / "lib/data-foundation/regions.json").read_text(encoding="utf-8"))["regions"]
    khorezm = next(r for r in regions if r["nameEn"].startswith("Xorazm"))
    W, H, cell = grid["width"], grid["height"], grid["cellDeg"]
    bbox = grid["bbox"]
    bits = np.unpackbits(np.frombuffer(base64.b64decode(grid["landBitmapB64"]), dtype=np.uint8))[: W * H]
    layers = {}
    for name, layer in grid["layers"].items():
        raw = np.frombuffer(base64.b64decode(layer["dataB64"]), dtype=np.uint8).astype(np.float64)
        raw[raw == grid["noData"]] = np.nan
        layers[name] = raw * layer["scale"] + layer["offset"]

    land_rows, land_cols = [], []
    idx = -1
    cell_values = {k: [] for k in MEASURED}
    for row in range(H):
        clat = bbox["maxLat"] - (row + 0.5) * cell
        for col in range(W):
            if not bits[row * W + col]:
                continue
            idx += 1
            clon = bbox["minLon"] + (col + 0.5) * cell
            if any(point_in_ring(clon, clat, ring) for ring in khorezm["polygon"] if len(ring) >= 10):
                land_rows.append(row)
                land_cols.append(col)
                for k in MEASURED:
                    # Grid stores no silt layer: farm silt is the texture
                    # residual (100 - sand - clay), as in lib/soil-grid.ts.
                    if k == "siltPct":
                        s, c = layers["sandPct"][idx], layers["clayPct"][idx]
                        v = np.nan if np.isnan(s) or np.isnan(c) else max(0.0, 100.0 - s - c)
                    else:
                        v = layers[k][idx]
                    if not np.isnan(v):
                        cell_values[k].append(v)
    print(f"Khorezm grid cells inside ADM1 polygon: {len(land_rows)}")
    print(f"{'property':<12} {'measured(lab)':>14} {'SoilGrids grid':>15} {'difference':>11}")
    for k, measured in MEASURED.items():
        vals = np.array(cell_values[k])
        modelled = float(vals.mean())
        print(f"{k:<12} {measured:>14.2f} {modelled:>15.2f} {modelled - measured:>+11.2f}   (cells {vals.size}, grid std {vals.std():.2f})")
    print()
    print("Interpretation: regional-scale plausibility/bias check only.")
    print("Farm-level empirical accuracy cannot be verified: no openly")
    print("obtainable georeferenced Uzbekistan farm soil-test dataset exists.")


if __name__ == "__main__":
    main()
