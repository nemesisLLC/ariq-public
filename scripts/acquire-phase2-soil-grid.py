#!/usr/bin/env python3
"""ARIQ Phase 2 — farm-specific SoilGrids grid acquisition (repeatable).

Run with the project venv:
    .venv/Scripts/python.exe scripts/acquire-phase2-soil-grid.py

Extends the Phase 1 WCS pipeline (scripts/acquire-phase1-data.py) from
14 regional aggregates to a national, location-specific grid:

- Same source: ISRIC SoilGrids 2.0 via WCS 1.0 (maps.isric.org), CC BY 4.0.
- Same depth weighting: 0-5 / 5-15 / 15-30 cm weighted 5/10/15.
- The WCS server is asked for a 0.01-degree grid (1745 x 885 cells over the
  Uzbekistan bbox). The SoilGrids source models at 250 m; the WCS response
  resamples that source onto the requested grid, so each stored cell is a
  ~1 km aggregate OF the 250 m predictions — never a field measurement.
- Uncertainty: SoilGrids Q0.05/Q0.95 at 5-15 cm for sand, clay, SOC and pH,
  stored as interval widths (q95 - q05).
- Storage is Cloudflare-Free friendly: only cells inside the union of the
  14 ADM1 polygons are kept, in scan order, quantized to uint8 and
  base64-encoded. A land bitmap maps grid cells to stored rows. No raster
  binaries enter Git; this JSON is the compact derived product.

Output: lib/data-intelligence/soil-grid.json
"""
import base64
import json
import urllib.request
from datetime import date
from pathlib import Path

import numpy as np
import tifffile

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "lib" / "data-intelligence"
TODAY = date.today().isoformat()
UA = {"User-Agent": "ARIQ-phase2-acquisition/1.0 (research; https://github.com/nemesisLLC/ariq)"}

BBOX = (55.9, 36.9, 73.35, 45.75)  # minLon, minLat, maxLon, maxLat (as Phase 1)
CELL_DEG = 0.01
W = int(round((BBOX[2] - BBOX[0]) / CELL_DEG))  # 1745
H = int(round((BBOX[3] - BBOX[1]) / CELL_DEG))  # 885
DEPTHS = [("0-5cm", 5), ("5-15cm", 10), ("15-30cm", 15)]
SCALE = {"sand": 0.1, "clay": 0.1, "silt": 0.1, "soc": 0.1, "phh2o": 0.1, "bdod": 0.01, "cec": 0.1}
UNCERTAINTY_PROPS = ("sand", "clay", "soc", "phh2o")


def fetch_coverage(prop: str, depth: str, stat: str) -> np.ndarray:
    url = (
        f"https://maps.isric.org/mapserv?map=/map/{prop}.map&SERVICE=WCS&VERSION=1.0.0"
        f"&REQUEST=GetCoverage&COVERAGE={prop}_{depth}_{stat}&FORMAT=GEOTIFF_INT16"
        f"&BBOX={BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]}&CRS=EPSG:4326&WIDTH={W}&HEIGHT={H}"
    )
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=300) as r:
        raw = r.read()
    path = Path.home() / "AppData/Local/Temp" / f"sg2-{prop}-{depth}-{stat}.tif"
    path.write_bytes(raw)
    a = tifffile.imread(str(path)).astype(np.float64)
    if a.shape != (H, W):
        raise RuntimeError(f"{prop} {depth} {stat}: unexpected shape {a.shape}, expected {(H, W)}")
    a[a == -32768] = np.nan
    return a


def depth_weighted(prop: str) -> np.ndarray:
    # Weighted mean over VALID layers only. (np.nansum would turn all-NaN
    # cells into 0.0, silently fabricating a value where SoilGrids has
    # nodata; those cells must stay NaN so they become the 255 sentinel.)
    acc = np.zeros((H, W))
    wsum = np.zeros((H, W))
    for depth, thick in DEPTHS:
        a = fetch_coverage(prop, depth, "mean") * SCALE[prop]
        valid = ~np.isnan(a)
        acc[valid] += a[valid] * thick
        wsum[valid] += thick
        print(f"SoilGrids {prop} {depth} mean ok", flush=True)
    out = np.full((H, W), np.nan)
    np.divide(acc, wsum, out=out, where=wsum > 0)
    return out


def land_mask(regions) -> np.ndarray:
    """Union of ALL ADM1 polygon rings (Phase 1 fix preserved: ring[0] alone
    drops Fergana/Tashkent exclave geometry). Cell-centre inclusion."""
    lons = BBOX[0] + (np.arange(W) + 0.5) * CELL_DEG
    mask = np.zeros((H, W), dtype=bool)
    for region in regions:
        for ring in region["polygon"]:
            if len(ring) < 10:
                continue
            ring = np.asarray(ring, dtype=np.float64)
            r_lats = ring[:, 1]
            edges = [(ring[i], ring[(i + 1) % len(ring)]) for i in range(len(ring))]
            for row in range(H):
                lat = BBOX[3] - (row + 0.5) * CELL_DEG
                if lat < r_lats.min() or lat > r_lats.max():
                    continue
                xs = []
                for (x1, y1), (x2, y2) in edges:
                    if (y1 > lat) != (y2 > lat):
                        xs.append(x1 + (x2 - x1) * (lat - y1) / (y2 - y1))
                xs.sort()
                for k in range(0, len(xs) - 1, 2):
                    c0 = max(0, int(np.searchsorted(lons, xs[k])))
                    c1 = min(W - 1, int(np.searchsorted(lons, xs[k + 1])))
                    if c1 >= c0:
                        mask[row, c0:c1 + 1] = True
    return mask


def q_u8(values: np.ndarray, scale: float, offset: float = 0.0) -> np.ndarray:
    """Quantize to uint8; NaN -> 255 sentinel."""
    out = np.full(values.shape, 255, dtype=np.uint8)
    ok = ~np.isnan(values)
    out[ok] = np.clip(np.round((values[ok] - offset) * scale), 0, 254).astype(np.uint8)
    return out


def b64(arr: np.ndarray) -> str:
    return base64.b64encode(arr.tobytes()).decode("ascii")


def main() -> None:
    regions = json.loads((ROOT / "lib/data-foundation/regions.json").read_text(encoding="utf-8"))["regions"]
    print("building land mask...", flush=True)
    mask = land_mask(regions)
    land_idx = np.flatnonzero(mask.ravel())
    print(f"land cells {land_idx.size} of {W * H}", flush=True)

    means = {}
    for prop in ("sand", "clay", "soc", "phh2o"):  # silt: derived residual downstream
        means[prop] = depth_weighted(prop)

    widths = {}
    for prop in UNCERTAINTY_PROPS:
        lo = fetch_coverage(prop, "5-15cm", "Q0.05") * SCALE[prop]
        hi = fetch_coverage(prop, "5-15cm", "Q0.95") * SCALE[prop]
        widths[prop] = hi - lo
        print(f"SoilGrids {prop} Q05/Q95 ok", flush=True)

    flat = lambda a: a.ravel()[land_idx]  # noqa: E731
    # Mean layers at the full 0.01-degree grid. Farm silt is NOT stored:
    # lib/soil-grid.ts derives it as the texture residual (100 - sand -
    # clay) so texture always closes; the independent SoilGrids silt mean
    # remains available in the Phase 1 regional file.
    layers = {
        # name -> (quantized land-ordered uint8, decode scale, decode offset, unit)
        "sandPct": (q_u8(flat(means["sand"]), 1.0), 1.0, 0.0, "%"),
        "clayPct": (q_u8(flat(means["clay"]), 1.0), 1.0, 0.0, "%"),
        "socGPerKg": (q_u8(flat(means["soc"]), 2.0), 0.5, 0.0, "g/kg"),
        "ph": (q_u8(flat(means["phh2o"]), 20.0, 3.0), 0.05, 3.0, "pH"),
    }

    # Uncertainty widths are spatially smooth, so they are stored on a
    # coarser 0.02-degree grid (2x2 block means over valid cells) to keep
    # the persisted file inside Cloudflare Free Worker size limits.
    cw = (W + 1) // 2
    ch = (H + 1) // 2

    def coarse(arr: np.ndarray) -> np.ndarray:
        padded = np.full((ch * 2, cw * 2), np.nan)
        padded[:H, :W] = arr
        blocks = padded.reshape(ch, 2, cw, 2)
        with np.errstate(all="ignore"):
            out = np.nanmean(np.where(np.isnan(blocks), np.nan, blocks), axis=(1, 3))
        return out

    coarse_mask = coarse(np.where(mask, 1.0, np.nan)) > 0
    coarse_idx = np.flatnonzero(coarse_mask.ravel())
    cflat = lambda a: coarse(a).ravel()[coarse_idx]  # noqa: E731
    width_layers = {
        "sandWidthPct": (q_u8(cflat(widths["sand"]), 1.0), 1.0, 0.0, "% (Q0.95-Q0.05)"),
        "clayWidthPct": (q_u8(cflat(widths["clay"]), 1.0), 1.0, 0.0, "% (Q0.95-Q0.05)"),
        "socWidthGPerKg": (q_u8(cflat(widths["soc"]), 2.0), 0.5, 0.0, "g/kg (Q0.95-Q0.05)"),
        "phWidth": (q_u8(cflat(widths["phh2o"]), 20.0, 0.0), 0.05, 0.0, "pH (Q0.95-Q0.05)"),
    }
    print(f"coarse width cells {coarse_idx.size} of {cw * ch}", flush=True)

    doc = {
        "kind": "soilgrids-national-grid",
        "retrievedAt": TODAY,
        "source": "ISRIC SoilGrids 2.0 via WCS 1.0 (maps.isric.org)",
        "license": "CC BY 4.0 (ISRIC SoilGrids)",
        "measurementKind": "modeled-estimate",
        "method": (
            "Phase 1 WCS pipeline at a 0.01-degree requested grid; 0-30 cm depth-weighted "
            "means (5/10/15 cm layers); uncertainty widths from Q0.05/Q0.95 at 5-15 cm. "
            "Cells inside the union of the 14 ADM1 polygons only, scan order, uint8-quantized."
        ),
        "resolutionNote": (
            "SoilGrids source models at 250 m; the WCS response resamples onto this ~1 km grid. "
            "Farm values are modelled predictions for the containing cell, NOT laboratory "
            "measurements and NOT 250 m-native samples. Regional Phase 1 estimates remain fallback."
        ),
        "bbox": {"minLon": BBOX[0], "minLat": BBOX[1], "maxLon": BBOX[2], "maxLat": BBOX[3]},
        "cellDeg": CELL_DEG,
        "width": W,
        "height": H,
        "landCells": int(land_idx.size),
        "landBitmapB64": b64(np.packbits(mask.ravel())),
        "noData": 255,
        "layers": {
            name: {"dataB64": b64(q), "scale": scale, "offset": offset, "unit": unit}
            for name, (q, scale, offset, unit) in layers.items()
        },
        "widthGrid": {
            "cellDeg": CELL_DEG * 2,
            "width": cw,
            "height": ch,
            "landCells": int(coarse_idx.size),
            "landBitmapB64": b64(np.packbits(coarse_mask.ravel())),
            "layers": {
                name: {"dataB64": b64(q), "scale": scale, "offset": offset, "unit": unit}
                for name, (q, scale, offset, unit) in width_layers.items()
            },
        },
    }
    out_path = OUT / "soil-grid.json"
    out_path.write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {out_path} bytes={out_path.stat().st_size} landCells={land_idx.size}")


if __name__ == "__main__":
    main()
