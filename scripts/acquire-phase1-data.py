#!/usr/bin/env python3
"""ARIQ Phase 1 data acquisition (repeatable, provenance-preserving).

Run with the project venv:
    .venv/Scripts/python.exe scripts/acquire-phase1-data.py

Outputs (compact JSON, no raster binaries in Git):
- lib/data-intelligence/siat-water.json   — SIAT SDMX water-withdrawal datasets
- lib/data-intelligence/soil-regions.json — ISRIC SoilGrids WCS regional statistics

Every record keeps source URL, retrieval date, units, resolution and licence.
SoilGrids values are MODELLED predictions (250 m source, aggregated here);
SIAT values are official reported statistics prepared by the Ministry of
Water Resources. Nothing here is a farm measurement.
"""
import json
import time
import urllib.request
from datetime import date
from pathlib import Path

import numpy as np
import tifffile

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "lib" / "data-intelligence"
OUT.mkdir(parents=True, exist_ok=True)
TODAY = date.today().isoformat()
UA = {"User-Agent": "ARIQ-phase1-acquisition/1.0 (research; https://github.com/nemesisLLC/ariq)"}

# ---------------------------------------------------------------- SIAT ----
SIAT_IDS = [3505, 3506, 3507, 3508, 3509, 3510, 3511, 3512, 3513]

def fetch_json(url: str, retries: int = 3):
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=45) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"failed {url}: {last}")

def acquire_siat() -> dict:
    datasets = []
    for ds_id in SIAT_IDS:
        meta = fetch_json(f"https://api.siat.stat.uz/sdmx/{ds_id}/table/download/?download_format=json")
        doc = fetch_json(meta["file"])
        if isinstance(doc, list):
            doc = doc[0]
        md = {m.get("name_en"): m.get("value_en") for m in doc.get("metadata", [])}
        rows = []
        for row in doc.get("data", []):
            values = {int(y): v for y, v in row.items() if y.isdigit() and isinstance(v, (int, float))}
            rows.append({"geography": row.get("Klassifikator_en"), "code": row.get("Code"), "values": values})
        datasets.append({
            "datasetId": ds_id,
            "indicatorCode": md.get("Indicator identification number (code)"),
            "indicator": md.get("Indicator name"),
            "unit": md.get("Unit of measurement"),
            "periodicity": md.get("Periodicity"),
            "preparer": md.get("Official statistics preparer"),
            "sourceUrl": f"https://siat.stat.uz/data/{ds_id}/?lang=en",
            "downloadUrl": meta["file"],
            "updatedAt": (meta.get("updated_at") or "")[:10],
            "retrievedAt": TODAY,
            "measurementKind": "reported",
            "license": "Uzbekistan official statistics (SIAT portal terms); prepared by the Ministry of Water Resources",
            "rows": rows,
        })
        print(f"SIAT {ds_id}: {md.get('Indicator name')} rows={len(rows)}")
    return {"kind": "siat-water-withdrawal", "retrievedAt": TODAY, "datasets": datasets}

# ------------------------------------------------------------- SoilGrids --
BBOX = (55.9, 36.9, 73.35, 45.75)  # minLon, minLat, maxLon, maxLat
W, H = 512, 256
DEPTHS = [("0-5cm", 5), ("5-15cm", 10), ("15-30cm", 15)]
PROPS = {  # property -> (SoilGrids unit scale to SI/display unit, output unit)
    "sand": (0.1, "%"), "clay": (0.1, "%"), "silt": (0.1, "%"),
    "soc": (0.1, "g/kg"), "phh2o": (0.1, "pH"), "bdod": (0.01, "g/cm3"), "cec": (0.1, "cmol(c)/kg"),
}

def fetch_coverage(prop: str, depth: str, stat: str) -> np.ndarray:
    url = (
        f"https://maps.isric.org/mapserv?map=/map/{prop}.map&SERVICE=WCS&VERSION=1.0.0"
        f"&REQUEST=GetCoverage&COVERAGE={prop}_{depth}_{stat}&FORMAT=GEOTIFF_INT16"
        f"&BBOX={BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]}&CRS=EPSG:4326&WIDTH={W}&HEIGHT={H}"
    )
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r:
        raw = r.read()
    path = Path.home() / "AppData/Local/Temp" / f"sg-{prop}-{depth}-{stat}.tif"
    path.write_bytes(raw)
    a = tifffile.imread(str(path)).astype(np.float64)
    a[a == -32768] = np.nan
    return a

def point_in_ring(lon: float, lat: float, ring) -> bool:
    inside = False
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % n]
        if (y1 > lat) != (y2 > lat) and lon < (x2 - x1) * (lat - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside

def region_masks(regions) -> dict:
    masks = {}
    lons = np.linspace(BBOX[0], BBOX[2], W)
    for region in regions:
        # Union of ALL rings: some regions (Fergana, Tashkent) have several
        # rings (exclaves / city enclave geometry); ring[0] alone is wrong.
        mask = np.zeros((H, W), dtype=bool)
        for ring in region["polygon"]:
            if len(ring) < 10:
                continue
            r_lats = [p[1] for p in ring]
            edges = [(ring[i], ring[(i + 1) % len(ring)]) for i in range(len(ring))]
            ring_mask = np.zeros((H, W), dtype=bool)
            for row in range(H):
                lat = BBOX[3] - (BBOX[3] - BBOX[1]) * row / (H - 1)
                if lat < min(r_lats) or lat > max(r_lats):
                    continue
                xs = []
                for (x1, y1), (x2, y2) in edges:
                    if (y1 > lat) != (y2 > lat):
                        xs.append(x1 + (x2 - x1) * (lat - y1) / (y2 - y1))
                xs.sort()
                for k in range(0, len(xs) - 1, 2):
                    c0 = max(0, int(np.searchsorted(lons, xs[k])))
                    c1 = min(W - 1, int(np.searchsorted(lons, xs[k + 1])))
                    ring_mask[row, c0:c1 + 1] = True
            mask |= ring_mask
        masks[region["nameEn"]] = mask
    return masks

def stats(arr: np.ndarray, mask: np.ndarray):
    vals = arr[mask & ~np.isnan(arr)]
    if vals.size < 5:
        return None
    return {
        "mean": round(float(vals.mean()), 2),
        "p10": round(float(np.percentile(vals, 10)), 2),
        "p90": round(float(np.percentile(vals, 90)), 2),
        "pixels": int(vals.size),
    }

def acquire_soil() -> dict:
    regions = json.loads((ROOT / "lib/data-foundation/regions.json").read_text(encoding="utf-8"))["regions"]
    masks = region_masks(regions)
    weighted = {}   # (prop) -> depth-weighted array
    for prop, (scale, _unit) in PROPS.items():
        acc = np.zeros((H, W)); wsum = 0.0
        for depth, thick in DEPTHS:
            a = fetch_coverage(prop, depth, "mean") * scale
            layer_w = thick
            acc = np.nansum(np.dstack([acc, a * layer_w]), axis=2) if wsum else a * layer_w
            wsum += layer_w
            print(f"SoilGrids {prop} {depth} mean ok")
        weighted[prop] = acc / wsum
    uncertainty = {}
    for prop in ("sand", "clay"):
        scale = PROPS[prop][0]
        lo = fetch_coverage(prop, "5-15cm", "Q0.05") * scale
        hi = fetch_coverage(prop, "5-15cm", "Q0.95") * scale
        uncertainty[prop] = (lo, hi)
        print(f"SoilGrids {prop} Q05/Q95 ok")
    out_regions = []
    for region in regions:
        name = region["nameEn"]
        mask = masks[name]
        props = {}
        for prop, (_scale, unit) in PROPS.items():
            s = stats(weighted[prop], mask)
            if s:
                props[prop] = {**s, "unit": unit}
        unc = {}
        for prop, (lo, hi) in uncertainty.items():
            lo_s, hi_s = stats(lo, mask), stats(hi, mask)
            if lo_s and hi_s:
                unc[prop] = {"q05Mean": lo_s["mean"], "q95Mean": hi_s["mean"], "unit": PROPS[prop][1]}
        out_regions.append({
            "region": name,
            "centre": region["centre"],
            "soil": props,
            "uncertainty5to15cm": unc,
        })
    return {
        "kind": "soilgrids-regional-statistics",
        "retrievedAt": TODAY,
        "source": "ISRIC SoilGrids 2.0 via WCS 1.0 (maps.isric.org)",
        "license": "CC BY 4.0 (ISRIC SoilGrids)",
        "measurementKind": "modeled-estimate",
        "method": "National 512x256 WCS tiles per property/depth (source resolution 250 m, aggregated); 0-30 cm depth-weighted means (5/10/15 cm); regional statistics inside ADM1 polygons; sand/clay uncertainty from Q0.05/Q0.95 at 5-15 cm.",
        "resolutionNote": "Regional aggregates for context and priors. NOT field measurements; within-region variation (p10-p90) is reported because regional means hide it.",
        "regions": out_regions,
    }

if __name__ == "__main__":
    siat = acquire_siat()
    (OUT / "siat-water.json").write_text(json.dumps(siat, ensure_ascii=False, indent=1), encoding="utf-8")
    soil = acquire_soil()
    (OUT / "soil-regions.json").write_text(json.dumps(soil, ensure_ascii=False, indent=1), encoding="utf-8")
    print("done")
