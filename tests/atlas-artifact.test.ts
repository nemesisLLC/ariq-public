import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {artifactSurface,ARTIFACT_THICKNESS,RELIEF_HEIGHT_SCALE} from '../app/atlas/artifactGeometry.ts';
import {lonLatToWorld,worldToLonLat} from '../app/atlas/geo.ts';

test('solid artifact preserves its geographic top and closes at one level base',()=>{
  const positions=new Float32Array([0,.1,0,1,.3,0,0,.2,1,1,.6,1]);
  const before=new Float32Array(positions);
  const result=artifactSurface({gridW:2,gridH:2,positions,indices:new Uint32Array([0,2,1,1,2,3]),artifactBoundary:new Uint32Array([0,1,0,2,1,3,2,3])});
  assert.deepEqual(positions,before);
  for(let i=0;i<4;i++){
    assert.equal(result.positions[i*3],positions[i*3]);assert.equal(result.positions[i*3+2],positions[i*3+2]);
    assert.ok(Math.abs(result.positions[i*3+1]-positions[i*3+1]*RELIEF_HEIGHT_SCALE)<1e-6);
  }
  for(const index of result.lower.values())assert.ok(Math.abs(result.positions[index*3+1]+ARTIFACT_THICKNESS)<1e-6);
  for(let i=result.bottomOffset;i<result.positions.length/3;i++)assert.ok(Math.abs(result.positions[i*3+1]+ARTIFACT_THICKNESS)<1e-6);
  // Weld the intentional material/normal seams by position. Every geometric
  // edge must meet exactly two faces: no missing bottom, wall gaps or bridges.
  const key=(i:number)=>Array.from(result.positions.slice(i*3,i*3+3)).join(',');
  const counts=new Map<string,number>(),directions=new Map<string,number>();
  for(let i=0;i<result.indices.length;i+=3){const [a,b,c]=Array.from(result.indices.slice(i,i+3));for(const [u,v] of [[a,b],[b,c],[c,a]]){const edge=[key(u),key(v)].sort().join('|');counts.set(edge,(counts.get(edge)??0)+1);directions.set(edge,(directions.get(edge)??0)+(key(u)<key(v)?1:-1));}}
  assert.ok([...counts.values()].every(n=>n===2));
  assert.ok([...directions.values()].every(n=>n===0),'adjacent faces have consistent outward winding');
  assert.deepEqual(Array.from(result.indices.slice(0,result.topIndexCount)),[0,2,1,1,2,3]);
});

test('new display asset has real source identity, complete valid triangle topology and unchanged coordinate projection',()=>{
  const data=JSON.parse(fs.readFileSync(new URL('../public/data/uzbekistan-artifact-v2.json',import.meta.url),'utf8'));
  const report=JSON.parse(fs.readFileSync(new URL('../docs/frontend-review/geometry-verification.json',import.meta.url),'utf8'));
  assert.equal(data.version,2);assert.equal(data.provenance.boundaryUrl,'https://www.openstreetmap.org/relation/196240');assert.equal(data.provenance.tileCount,40);
  assert.equal(report.sourcePolygons,5);assert.equal(report.sourceHoles,1);assert.equal(report.boundaryHausdorffDegrees,0);assert.ok(report.relativePlanarAreaError<1e-10);
  const floats=Buffer.from(data.positionsB64,'base64'),ints=Buffer.from(data.indicesB64,'base64');
  const positions=new Float32Array(floats.buffer,floats.byteOffset,floats.byteLength/4),indices=new Uint32Array(ints.buffer,ints.byteOffset,ints.byteLength/4);
  const vertexCount=positions.length/3;assert.equal(vertexCount,report.vertices);assert.equal(indices.length/3,report.triangles);
  assert.ok(positions.every(Number.isFinite));assert.ok(indices.every(i=>i<vertexCount));
  let down=0;
  for(let i=0;i<indices.length;i+=3){const [a,b,c]=[indices[i]*3,indices[i+1]*3,indices[i+2]*3];const winding=(positions[b+2]-positions[a+2])*(positions[c]-positions[a])-(positions[b]-positions[a])*(positions[c+2]-positions[a+2]);if(winding< -1e-8)down++;}
  assert.equal(down,0);
  const boundary=Buffer.from(data.boundaryB64,'base64'),pairs=new Uint32Array(boundary.buffer,boundary.byteOffset,boundary.byteLength/4);
  for(const i of pairs){const [lon,lat]=worldToLonLat(positions[i*3],positions[i*3+2]);const [x,z]=lonLatToWorld(lon,lat);assert.ok(Math.abs(x-positions[i*3])<1e-10);assert.ok(Math.abs(z-positions[i*3+2])<1e-10);}
});
