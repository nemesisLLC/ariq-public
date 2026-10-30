"""Build a small, reproducible Samarkand relief from public elevation tiles."""
import io, json, math, urllib.request, urllib.parse
from pathlib import Path
from datetime import datetime, timezone
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public' / 'data'
OUT.mkdir(parents=True, exist_ok=True)
WEST, SOUTH, EAST, NORTH = 66.75, 39.40, 67.20, 39.82
N, ZOOM = 161, 11
tiles, urls = {}, []
def fetch(url, data=None):
    request = urllib.request.Request(url, data=data, headers={'User-Agent':'ARIQ terrain research prototype'})
    with urllib.request.urlopen(request, timeout=90) as response:
        return response.read()
def pixel(lon, lat):
    x = (lon + 180) / 360 * 2**ZOOM * 256
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * 2**ZOOM * 256
    return x, y
def elevation(lon, lat):
    x,y=pixel(lon,lat)
    key=(int(x)//256,int(y)//256)
    if key not in tiles:
        url=f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{ZOOM}/{key[0]}/{key[1]}.png'
        tiles[key]=Image.open(io.BytesIO(fetch(url))).convert('RGB')
        urls.append(url)
    r,g,b=tiles[key].getpixel((int(x)%256,int(y)%256))
    return round(r*256+g+b/256-32768,1)
heights=[elevation(WEST+(EAST-WEST)*x/(N-1),NORTH-(NORTH-SOUTH)*y/(N-1)) for y in range(N) for x in range(N)]
payload={'bounds':[WEST,SOUTH,EAST,NORTH],'size':N,'heights':heights,'min':min(heights),'max':max(heights),'retrievedAt':datetime.now(timezone.utc).isoformat(),'source':'Mapzen Terrain Tiles / AWS Open Data','sourceUrl':'https://registry.opendata.aws/terrain-tiles/','tiles':urls,'attribution':'Global GMTED2010 and SRTM terrain data courtesy of the U.S. Geological Survey; global ETOPO1 terrain data U.S. National Oceanic and Atmospheric Administration. Mapzen terrain tiles.','note':'Historical elevation model, sampled to a 161 × 161 grid. Not live terrain. Relief exaggerated 3× for display.'}
(OUT/'samarkand-terrain.json').write_text(json.dumps(payload,separators=(',',':')),encoding='utf-8')
print(f'Terrain: {N*N} samples, {len(tiles)} source tiles, {min(heights)}–{max(heights)} m')
query=f'[out:json][timeout:60];way["waterway"~"^(river|canal)$"]({SOUTH},{WEST},{NORTH},{EAST});out tags geom;'
raw=json.loads(fetch('https://overpass.kumi.systems/api/interpreter?'+urllib.parse.urlencode({'data':query})))
ways=[{'id':w['id'],'name':w.get('tags',{}).get('name:en',w.get('tags',{}).get('name','Unnamed mapped waterway')),'kind':w['tags']['waterway'],'coordinates':[[p['lon'],p['lat']] for p in w.get('geometry',[])]} for w in raw.get('elements',[]) if w.get('geometry')]
(OUT/'samarkand-waterways.json').write_text(json.dumps({'ways':ways,'retrievedAt':datetime.now(timezone.utc).isoformat(),'osmTimestamp':raw.get('osm3s',{}).get('timestamp_osm_base'),'sourceUrl':'https://www.openstreetmap.org/copyright','license':'ODbL 1.0','attribution':'© OpenStreetMap contributors','query':query,'note':'Mapped river and canal centerlines. Incomplete coverage; no flow measurements or connectivity guarantees.'},ensure_ascii=False,separators=(',',':')),encoding='utf-8')
print(f'Waterways: {len(ways)} mapped ways')
