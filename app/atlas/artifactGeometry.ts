import {worldToLonLat,UZ_BBOX} from './geo.ts';
import type {ReliefData,WaterFeature} from './terrain.ts';

export const RELIEF_HEIGHT_SCALE=.28;
export const ARTIFACT_THICKNESS=1.15;

/** Display geometry only. Preserve the source DEM, its coordinate system and scientific measurements. */
export function artifactSurface(data:Pick<ReliefData,'positions'|'indices'|'gridW'|'gridH'|'artifactBoundary'>) {
  const n=data.artifactBoundary?data.positions.length/3:data.gridW*data.gridH,positions=new Float32Array(n*3),triangles:number[]=data.artifactBoundary?Array.from(data.indices):[];
  positions.set(data.positions.subarray(0,n*3));
  const edges=new Map<string,{a:number;b:number;count:number}>();
  for(let i=0;!data.artifactBoundary&&i<data.indices.length;i+=3){
    const a=data.indices[i],b=data.indices[i+1],c=data.indices[i+2];
    if(a>=n||b>=n||c>=n)continue;
    triangles.push(a,b,c);
    for(const [x,y] of [[a,b],[b,c],[c,a]]){const key=x<y?`${x}:${y}`:`${y}:${x}`,e=edges.get(key);if(e)e.count++;else edges.set(key,{a:x,b:y,count:1});}
  }
  const boundary=data.artifactBoundary?Array.from({length:data.artifactBoundary.length/2},(_,i)=>({a:data.artifactBoundary![i*2],b:data.artifactBoundary![i*2+1],count:1})):[...edges.values()].filter(e=>e.count===1),neighbors=new Map<number,number[]>();
  // The stored edge list is unordered (sorted vertex IDs), not a directed ring.
  // Recover orientation from the upward-facing top triangles before building
  // walls. Otherwise alternating faces point inward and leave visible slits.
  const borderByKey=new Map(boundary.map(e=>[e.a<e.b?`${e.a}:${e.b}`:`${e.b}:${e.a}`,e]));
  for(let i=0;i<triangles.length;i+=3){const [a,b,c]=triangles.slice(i,i+3);for(const [u,v] of [[a,b],[b,c],[c,a]]){const edge=borderByKey.get(u<v?`${u}:${v}`:`${v}:${u}`);if(edge){edge.a=u;edge.b=v;}}}
  for(const {a,b} of boundary){neighbors.set(a,[...(neighbors.get(a)??[]),b]);neighbors.set(b,[...(neighbors.get(b)??[]),a]);}
  // Never smooth x/z by eye. The v2 asset uses the real national boundary, including its holes and exclaves.
  for(let i=1;i<positions.length;i+=3)positions[i]=Math.max(0,positions[i])*RELIEF_HEIGHT_SCALE;
  const out=Array.from(positions),indices=[...triangles],edgeStart=triangles.length;
  const lower=new Map<number,number>(),sideTop=new Map<number,number>(),shoulder=new Map<number,number>(),foot=new Map<number,number>();
  for(const index of neighbors.keys()){
    const x=positions[index*3],y=positions[index*3+1],z=positions[index*3+2];
    for(const [ring,height] of [[sideTop,y],[shoulder,y-.065],[foot,-ARTIFACT_THICKNESS+.065],[lower,-ARTIFACT_THICKNESS]] as const){ring.set(index,out.length/3);out.push(x,height,z);}
  }
  // The geographic top is untouched. The display object's walls terminate on
  // one level datum, rather than copying every DEM peak into a serrated underside.
  const rings=[sideTop,shoulder,foot,lower];
  for(const {a,b} of boundary)for(let band=0;band<rings.length-1;band++){const ta=rings[band].get(a)!,tb=rings[band].get(b)!,la=rings[band+1].get(a)!,lb=rings[band+1].get(b)!;indices.push(ta,la,lb,ta,lb,tb);}
  const bottomStart=indices.length,bottomOffset=out.length/3;
  // Reuse the constrained national triangulation, reversing its winding. This
  // closes the base without bridging the source's holes or joining its exclaves.
  for(let i=0;i<n;i++)out.push(positions[i*3],-ARTIFACT_THICKNESS,positions[i*3+2]);
  for(let i=0;i<triangles.length;i+=3)indices.push(bottomOffset+triangles[i],bottomOffset+triangles[i+2],bottomOffset+triangles[i+1]);
  return {positions:new Float32Array(out),indices:new Uint32Array(indices),topIndexCount:edgeStart,bottomStart,bottomOffset,boundary,sideTop,shoulder,foot,lower,sourceVertexCount:n};
}

export function insideRelief(data:Pick<ReliefData,'mask'|'gridW'|'gridH'>,lon:number,lat:number) {
  const col=Math.round((lon-UZ_BBOX.minLon)/(UZ_BBOX.maxLon-UZ_BBOX.minLon)*(data.gridW-1));
  const row=Math.round((UZ_BBOX.maxLat-lat)/(UZ_BBOX.maxLat-UZ_BBOX.minLat)*(data.gridH-1));
  return col>=0&&col<data.gridW&&row>=0&&row<data.gridH&&!!data.mask[row*data.gridW+col];
}

export function clippedWater(data:ReliefData,features:WaterFeature[]):WaterFeature[] {
  // Border rivers must not disappear because two independently mapped datasets
  // put their centreline on opposite sides of a raster-mask edge. Keep nearby
  // source vertices at their original coordinates; never snap them into land.
  const visible=(lon:number,lat:number)=>{
    if(insideRelief(data,lon,lat))return true;
    const dx=(UZ_BBOX.maxLon-UZ_BBOX.minLon)/(data.gridW-1),dy=(UZ_BBOX.maxLat-UZ_BBOX.minLat)/(data.gridH-1);
    for(const x of [-2,0,2])for(const y of [-2,0,2])if(insideRelief(data,lon+x*dx,lat+y*dy))return true;
    return false;
  };
  return features.flatMap(feature=>{
    const runs:number[][][]=[];let run:number[][]=[];
    for(const coordinate of feature.geometry.coordinates as number[][]){if(visible(coordinate[0],coordinate[1]))run.push(coordinate);else {if(run.length>=2)runs.push(run);run=[];}}
    if(run.length>=2)runs.push(run);
    return runs.map(coordinates=>({...feature,geometry:{type:'LineString',coordinates}}));
  });
}
