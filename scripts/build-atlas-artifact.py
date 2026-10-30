"""Offline display asset, not a scientific engine. Shapely/Pillow are build tools only.

Inputs are the saved OSM/Nominatim country response and the same public Mapzen
Terrarium tiles used by terrain.ts. No invented features, smoothing or hand-drawn
geography. Run with an isolated PYTHONPATH containing shapely 2.1.2 + pillow.
"""
import base64
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import urllib.request

import numpy as np
from PIL import Image
from shapely import box, constrained_delaunay_triangles, intersects_xy
from shapely.geometry import shape
from shapely.prepared import prep

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'docs/frontend-review/uzbekistan-outline-response.json'
record = json.loads(RAW.read_text(encoding='utf-8'))[0]
assert record['osm_type'] == 'relation' and record['osm_id'] == 196240
assert record['address']['country_code'] == 'uz'
country = shape(record['geojson'])
assert country.is_valid, 'Source boundary is invalid; do not silently repair it.'
MIN_LON, MIN_LAT, MAX_LON, MAX_LAT = 55.9, 36.9, 73.35, 45.75
W, H, ZOOM = 840, 568, 7
SCALE = 34 / ((MAX_LON - MIN_LON) * math.cos(math.radians(41.32)))
COS = math.cos(math.radians(41.32))
N = 2 ** ZOOM * 256

def pixel(lon, lat):
    r = math.radians(lat)
    return (lon + 180) / 360 * N, (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * N

x0, y1 = pixel(MIN_LON, MIN_LAT)
x1, y0 = pixel(MAX_LON, MAX_LAT)
TX0, TX1, TY0, TY1 = int(x0 // 256), int(x1 // 256), int(y0 // 256), int(y1 // 256)
cache = ROOT / 'review-captures/dem-source-z7'
cache.mkdir(parents=True, exist_ok=True)
tiles = [(x,y) for x in range(TX0, TX1+1) for y in range(TY0, TY1+1)]

def fetch_tile(tile):
    x,y = tile
    local = cache / f'{ZOOM}-{x}-{y}.png'
    url = f'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{ZOOM}/{x}/{y}.png'
    if not local.exists():
        request = urllib.request.Request(url, headers={'User-Agent':'ARIQ-local-terrain-build/1.0'})
        with urllib.request.urlopen(request, timeout=35) as response:
            local.write_bytes(response.read())
    with Image.open(local) as image:
        assert image.size == (256,256)
        rgb = np.asarray(image.convert('RGB'),dtype=np.float32)
    return x,y,rgb[:,:,0]*256+rgb[:,:,1]+rgb[:,:,2]/256-32768

dem = np.zeros(((TY1-TY0+1)*256,(TX1-TX0+1)*256),dtype=np.float32)
with ThreadPoolExecutor(max_workers=4) as pool:
    for x,y,elevation in pool.map(fetch_tile, tiles):
        dem[(y-TY0)*256:(y-TY0+1)*256,(x-TX0)*256:(x-TX0+1)*256] = elevation
print(f'Loaded {len(tiles)} real Terrarium tiles', flush=True)

def sample(lon, lat):
    px, py = pixel(lon,lat)
    px = max(0,min(dem.shape[1]-1.001,px-TX0*256))
    py = max(0,min(dem.shape[0]-1.001,py-TY0*256))
    x,y = int(px),int(py)
    fx,fy = px-x,py-y
    return max(0,float((dem[y,x]*(1-fx)+dem[y,x+1]*fx)*(1-fy)+(dem[y+1,x]*(1-fx)+dem[y+1,x+1]*fx)*fy))

lons = np.linspace(MIN_LON,MAX_LON,W)
lats = np.linspace(MAX_LAT,MIN_LAT,H)
lon_grid,lat_grid = np.meshgrid(lons,lats)
mask = intersects_xy(country,lon_grid,lat_grid).astype(np.uint8)
heights = np.asarray([[round(sample(lon,lat)) for lon in lons] for lat in lats],dtype='<i2')
prepared = prep(country)
vertices, geocoords, indices, lookup = [], [], [], {}
area = 0.0

def display_sample(lon,lat):
    col = max(0,min(W-1.001,(lon-MIN_LON)/(MAX_LON-MIN_LON)*(W-1)))
    row = max(0,min(H-1.001,(MAX_LAT-lat)/(MAX_LAT-MIN_LAT)*(H-1)))
    x,y=int(col),int(row)
    fx,fy=col-x,row-y
    return float((heights[y,x]*(1-fx)+heights[y,x+1]*fx)*(1-fy)+(heights[y+1,x]*(1-fx)+heights[y+1,x+1]*fx)*fy)

def index(p):
    lon,lat = float(p[0]),float(p[1])
    key = (round(lon,12),round(lat,12))
    if key not in lookup:
        lookup[key] = len(vertices)//3
        geocoords.append((lon,lat))
        vertices.extend(((lon-64.62)*COS*SCALE, display_sample(lon,lat)*0.00038, -(lat-41.32)*SCALE))
    return lookup[key]

def triangle(coords):
    global area
    a,b,c = coords[:3]
    cross = (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
    if abs(cross)<1e-16: return
    area += abs(cross)/2
    if cross<0: b,c = c,b
    indices.extend((index(a),index(b),index(c)))

for row in range(H-1):
    for col in range(W-1):
        west,east,south,north = lons[col],lons[col+1],lats[row+1],lats[row]
        cell = box(west,south,east,north)
        if prepared.covers(cell):
            triangle([(west,north),(west,south),(east,north)])
            triangle([(east,north),(west,south),(east,south)])
        elif prepared.intersects(cell):
            clipped = country.intersection(cell)
            # GEOS constrained triangulation preserves actual boundary and hole segments.
            for face in constrained_delaunay_triangles(clipped).geoms:
                triangle(list(face.exterior.coords))
    if row%60==0: print(f'Triangulated row {row}/{H}',flush=True)

assert abs(area-country.area)/country.area<1e-10,(area,country.area)
edges = Counter()
for i in range(0,len(indices),3):
    a,b,c = indices[i:i+3]
    for u,v in ((a,b),(b,c),(c,a)): edges[tuple(sorted((u,v)))] += 1
assert max(edges.values())<=2
boundary = [edge for edge,count in edges.items() if count==1]
# Compare render boundary with the real source boundary, not a screenshot judgement.
from shapely import MultiLineString
render_boundary = MultiLineString([(geocoords[a],geocoords[b]) for a,b in boundary])
boundary_deviation = render_boundary.hausdorff_distance(country.boundary)
assert boundary_deviation<1e-9,boundary_deviation

def encode(value,dtype): return base64.b64encode(np.asarray(value,dtype=dtype).tobytes()).decode('ascii')
output = {
    'version':2,'gridW':W,'gridH':H,'bbox':{'minLon':MIN_LON,'minLat':MIN_LAT,'maxLon':MAX_LON,'maxLat':MAX_LAT},
    'positionsB64':encode(vertices,'<f4'),'indicesB64':encode(indices,'<u4'),
    'boundaryB64':encode(boundary,'<u4'),'elevationsB64':encode(heights,'<i2'),'maskB64':encode(mask,'u1'),
    'provenance':{'boundary':'OpenStreetMap relation 196240 via Nominatim','boundaryUrl':'https://www.openstreetmap.org/relation/196240','boundaryRequest':'https://nominatim.openstreetmap.org/lookup?osm_ids=R196240&format=jsonv2&polygon_geojson=1&polygon_threshold=0.001','providerSimplificationDegrees':0.001,'rawBoundarySha256':hashlib.sha256(RAW.read_bytes()).hexdigest(),'boundaryLicense':'ODbL 1.0','elevation':'Mapzen / AWS Terrarium zoom 7; bilinear interpolation, negatives clamped to zero for display','elevationUrl':'https://registry.opendata.aws/terrain-tiles/','tileCount':len(tiles),'generatedAt':datetime.now(timezone.utc).isoformat()},
}
target = ROOT / 'public/data/uzbekistan-artifact-v2.json'
target.write_text(json.dumps(output,separators=(',',':')),encoding='utf-8')
boundary_asset={'type':'Feature','properties':output['provenance'],'geometry':record['geojson']}
(ROOT/'public/data/uzbekistan-boundary-osm-v1.geojson').write_text(json.dumps(boundary_asset,separators=(',',':')),encoding='utf-8')
report={'vertices':len(vertices)//3,'triangles':len(indices)//3,'sourcePolygons':len(record['geojson']['coordinates']),'sourceHoles':sum(len(p)-1 for p in record['geojson']['coordinates']),'boundaryEdges':len(boundary),'renderAreaDegreesSquared':area,'sourceAreaDegreesSquared':country.area,'relativePlanarAreaError':abs(area-country.area)/country.area,'boundaryHausdorffDegrees':boundary_deviation,'assetBytes':target.stat().st_size,'newClientDependencies':0}
(ROOT/'docs/frontend-review/geometry-verification.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report,indent=2),flush=True)
