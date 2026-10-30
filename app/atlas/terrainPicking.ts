import type {BufferGeometry} from 'three';
import {MeshBVH} from 'three-mesh-bvh';
export {acceleratedRaycast} from 'three-mesh-bvh';

/** Accelerate exact picking without reordering or simplifying geographic triangles. */
export function indexTerrainPicking(geometry:BufferGeometry){
  geometry.boundsTree ??= new MeshBVH(geometry,{indirect:true});
}
