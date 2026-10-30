import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {artifactSurface} from '../app/atlas/artifactGeometry.ts';
import {indexTerrainPicking,acceleratedRaycast} from '../app/atlas/terrainPicking.ts';

test('BVH preserves original terrain buffers, groups and exact geographic hit points',()=>{
  const asset=JSON.parse(fs.readFileSync('public/data/uzbekistan-artifact-v2.json','utf8'));
  const floats=(s:string)=>new Float32Array(Uint8Array.from(Buffer.from(s,'base64')).buffer);
  const ints=(s:string)=>new Uint32Array(Uint8Array.from(Buffer.from(s,'base64')).buffer);
  const source={gridW:asset.gridW,gridH:asset.gridH,positions:floats(asset.positionsB64),indices:ints(asset.indicesB64),artifactBoundary:ints(asset.boundaryB64)};
  const surface=artifactSurface(source),geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(surface.positions,3));geometry.setIndex(new THREE.BufferAttribute(surface.indices,1));
  geometry.addGroup(0,surface.topIndexCount,0);geometry.addGroup(surface.topIndexCount,surface.indices.length-surface.topIndexCount,1);
  const positions=new Float32Array(surface.positions),indices=new Uint32Array(surface.indices),groups=structuredClone(geometry.groups);
  indexTerrainPicking(geometry);
  assert.deepEqual(geometry.getAttribute('position').array,positions);assert.deepEqual(geometry.index!.array,indices);assert.deepEqual(geometry.groups,groups);
  const material=[new THREE.MeshBasicMaterial(),new THREE.MeshBasicMaterial()],mesh=new THREE.Mesh(geometry,material);
  mesh.updateMatrixWorld();const ray=new THREE.Raycaster(),brute=THREE.Mesh.prototype.raycast;
  let hits=0;
  for(let i=0;i<24;i++){
    const index=Math.floor((i+.5)*surface.sourceVertexCount/24),x=positions[index*3],z=positions[index*3+2];
    ray.set(new THREE.Vector3(x+.013,15,z+.017),new THREE.Vector3(0,-1,0));
    const expected:THREE.Intersection[]=[],actual:THREE.Intersection[]=[];
    brute.call(mesh,ray,expected);acceleratedRaycast.call(mesh,ray,actual);expected.sort((a,b)=>a.distance-b.distance);actual.sort((a,b)=>a.distance-b.distance);
    assert.equal(actual.length,expected.length);
    if(expected.length){hits++;assert.ok(actual[0].point.distanceTo(expected[0].point)<1e-8);assert.equal(actual[0].faceIndex,expected[0].faceIndex);assert.equal(actual[0].face?.materialIndex,expected[0].face?.materialIndex);}
  }
  assert.ok(hits>=20);delete geometry.boundsTree;geometry.dispose();material.forEach(m=>m.dispose());
});
