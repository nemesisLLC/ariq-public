"""Extract mapped Zarafshon river centerlines, never inferred flows or canals."""
import json, urllib.request
from pathlib import Path
from datetime import datetime, timezone

ROOT=Path(__file__).resolve().parents[1]
BOUNDS=(66.75,39.40,67.20,39.82)
URL='https://api.openstreetmap.org/api/0.6/relation/3303320/full.json'
def clip(a,b):
    west,south,east,north=BOUNDS
    dx,dy=b[0]-a[0],b[1]-a[1]
    lo,hi=0.,1.
    for p,q in ((-dx,a[0]-west),(dx,east-a[0]),(-dy,a[1]-south),(dy,north-a[1])):
        if p==0:
            if q<0:return None
        else:
            t=q/p
            if p<0:lo=max(lo,t)
            else:hi=min(hi,t)
            if lo>hi:return None
    return [[a[0]+lo*dx,a[1]+lo*dy],[a[0]+hi*dx,a[1]+hi*dy]]
def extract(raw):
    nodes={e['id']:[e['lon'],e['lat']] for e in raw['elements'] if e['type']=='node'}
    ways=[]
    for element in raw['elements']:
        if element['type']!='way' or element.get('tags',{}).get('waterway')!='river':continue
        points=[nodes[n] for n in element['nodes'] if n in nodes]
        segment=[]
        def finish():
            if len(segment)>1:
                ways.append({'id':element['id'],'name':element.get('tags',{}).get('name:en','Zarafshon'),'kind':'river','coordinates':segment.copy()})
            segment.clear()
        for a,b in zip(points,points[1:]):
            clipped=clip(a,b)
            if clipped:
                if segment and segment[-1]!=clipped[0]:finish()
                if not segment:segment.append(clipped[0])
                segment.append(clipped[1])
            else:finish()
        finish()
    return {'ways':ways,'bounds':BOUNDS,'retrievedAt':datetime.now(timezone.utc).isoformat(),'sourceUrl':'https://www.openstreetmap.org/relation/3303320','apiUrl':URL,'license':'ODbL 1.0','attribution':'© OpenStreetMap contributors','note':'Mapped Zarafshon river centerline segments clipped to the terrain bounds. Incomplete waterways coverage. No canal network or measured flow data.'}
if __name__=='__main__':
    request=urllib.request.Request(URL,headers={'User-Agent':'ARIQ local terrain research'})
    with urllib.request.urlopen(request,timeout=45) as response:raw=json.load(response)
    result=extract(raw)
    (ROOT/'public/data/samarkand-waterways.json').write_text(json.dumps(result,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    print(f"Saved {len(result['ways'])} mapped river segments")
