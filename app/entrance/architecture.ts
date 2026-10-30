import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { finishMaps } from './finishes';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export const PORTAL = { halfWidth: 5.5, spring: 8, peak: 14, rearZ: -6.8, doorWidth: 2.05, doorHeight: 6.3 };

export function archOutline(w: number, spring: number, peak: number, base = -.5) {
  const p = new T.Shape();
  p.moveTo(-w, base); p.lineTo(-w, spring);
  p.bezierCurveTo(-w, spring + (peak - spring) * .48, -w * .38, peak - .7, 0, peak);
  p.bezierCurveTo(w * .38, peak - .7, w, spring + (peak - spring) * .48, w, spring);
  p.lineTo(w, base); p.closePath();
  return p;
}

// Density is expressed in world metres, including the side faces of extrusions.
function mapSurface(g: T.BufferGeometry, density = .32) {
  const p = g.getAttribute('position'), n = g.getAttribute('normal'), uv = g.getAttribute('uv');
  for (let i = 0; i < p.count; i++) {
    const x = Math.abs(n.getX(i)), y = Math.abs(n.getY(i)), z = Math.abs(n.getZ(i));
    if (z >= x && z >= y) uv.setXY(i, p.getX(i) * density, p.getY(i) * density);
    else if (y >= x) uv.setXY(i, p.getX(i) * density, p.getZ(i) * density);
    else uv.setXY(i, p.getZ(i) * density, p.getY(i) * density);
  }
  return g;
}

function microRelief() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const ctx = c.getContext('2d')!, data = ctx.createImageData(512, 512);
  let seed = 123;
  for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
    seed = (seed * 16807) % 2147483647;
    const grout = x % 64 < 2 || y % 64 < 2;
    const v = grout ? 84 : 165 + (seed / 2147483647 - .5) * 18;
    const k = (y * 512 + x) * 4;
    data.data[k] = data.data[k + 1] = data.data[k + 2] = v; data.data[k + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; return t;
}

/** Original architectural interpretation. Clear center aisle, curved conch vault, no image planes. */
export async function buildArchitecture(scene: T.Scene, renderer: T.WebGLRenderer) {
  const resources = new Set<{ dispose: () => void }>();
  const own = <V extends { dispose: () => void }>(v: V) => { resources.add(v); return v; };
  const loader = new T.TextureLoader();
  const textures = await Promise.allSettled([
    loader.loadAsync('/media/registan/ceramic.webp'), loader.loadAsync('/media/registan/gold.webp'),
  ]);
  for (const r of textures) if (r.status === 'fulfilled') own(r.value);
  if (textures.some(r => r.status === 'rejected')) { resources.forEach(r => r.dispose()); throw new Error('Architectural materials unavailable'); }
  const [ceramic, gilding] = textures.map(r => (r as PromiseFulfilledResult<T.Texture>).value);
  for (const texture of [ceramic, gilding]) {
    texture.colorSpace = T.SRGBColorSpace; texture.wrapS = texture.wrapT = T.RepeatWrapping;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  }
  const bump = own(microRelief());
  const stoneFinish=finishMaps('stone'),plasterFinish=finishMaps('plaster'),metalFinish=finishMaps('metal');
  for(const finish of [stoneFinish,plasterFinish,metalFinish])for(const texture of Object.values(finish)){own(texture);texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());}
  const plaster=own(new T.MeshStandardMaterial({color:'#a99a80',...plasterFinish,roughness:.96,normalScale:new T.Vector2(.7,.7)}));
  const blue = own(new T.MeshStandardMaterial({ map: ceramic, color:'#c6d2d1', roughness: .73, roughnessMap:stoneFinish.roughnessMap, metalness: .02, bumpMap: bump, bumpScale: .008 }));
  const paintedGold = own(new T.MeshStandardMaterial({ map: gilding, color:'#c6b99c', roughness: .79, roughnessMap:plasterFinish.roughnessMap, metalness: .08, normalMap:plasterFinish.normalMap, normalScale:new T.Vector2(.4,.4) }));
  const gold = own(new T.MeshStandardMaterial({ color: '#95733d', ...metalFinish, roughness: .67, metalness: .57, normalScale:new T.Vector2(.28,.28) }));
  const ivory = own(new T.MeshStandardMaterial({ color: '#baae96', ...plasterFinish, roughness: .92, normalScale:new T.Vector2(.65,.65) }));
  const lapis = own(new T.MeshStandardMaterial({ color: '#24475d', ...plasterFinish, roughness: .88, metalness: .02, normalScale:new T.Vector2(.45,.45) }));
  const turquoise = own(new T.MeshStandardMaterial({ color: '#2c767a', roughness: .48, metalness: .13 }));
  const stone = own(new T.MeshStandardMaterial({ color: '#a0947e', ...stoneFinish, roughness: .85, normalScale:new T.Vector2(.85,.85), vertexColors:true }));
  const mortar = own(new T.MeshStandardMaterial({ color: '#756c5b', roughness: .95 }));
  // Batch static geometry by material, preserving the visible dimensional surfaces.
  const batches = new Map<T.Material, T.BufferGeometry[]>();
  function add(g: T.BufferGeometry, m: T.Material, x = 0, y = 0, z = 0, rotation = 0) {
    if (rotation) g.rotateY(rotation); g.translate(x, y, z);
    if (!batches.has(m)) batches.set(m, []); batches.get(m)!.push(g);
  }
  function box(w: number, h: number, d: number, x: number, y: number, z: number, m: T.Material, rotation = 0) {
    add(mapSurface(new T.BoxGeometry(w, h, d)), m, x, y, z, rotation);
  }
  function extrude(shape: T.Shape, depth: number, m: T.Material, z: number, x = 0, y = 0, rot = 0, density = .32) {
    const g = new T.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSegments: 2, bevelSize: .012, bevelThickness: .012, curveSegments: 40 });
    add(mapSurface(g, density), m, x, y, z, rot);
  }
  function ring(w: number, spring: number, peak: number, thickness: number, z: number, material: T.Material, depth = .16, x = 0, y = 0, rot = 0) {
    const s = archOutline(w + thickness, spring, peak + thickness, -.7);
    s.holes.push(new T.Path(archOutline(w, spring, peak, -.5).getPoints(40).reverse()));
    extrude(s, depth, material, z, x, y, rot);
  }
  function wall(w: number, h: number, doorW: number, doorSpring: number, doorPeak: number, z: number, material: T.Material) {
    const s = new T.Shape([new T.Vector2(-w, -1), new T.Vector2(w, -1), new T.Vector2(w, h), new T.Vector2(-w, h)]);
    s.holes.push(new T.Path(archOutline(doorW, doorSpring, doorPeak).getPoints(40).reverse())); extrude(s, .65, material, z);
  }
  // Three substantial recessed architectural orders. The foreground is framing, not a flat border.
  wall(16, 23, 5.5, 8, 14, .55, lapis);
  const orders: [number, number, number, number, number, T.Material][] = [
    [5.5, 8, 14, .11, 1.26, ivory], [5.65, 8, 14.18, .09, 1.38, gold],
    [5.79, 8, 14.34, .72, 1.18, paintedGold], [6.56, 8, 15.13, .1, 1.36, ivory],
    [6.72, 8, 15.32, .26, 1.27, lapis], [7.03, 8, 15.65, .1, 1.39, gold],
    [7.19, 8, 15.82, .15, 1.25, ivory],
    [5.32, 7.9, 13.72, .12, -.24, gold], [5.1, 7.85, 13.42, .18, -.6, blue],
  ];
  orders.forEach(([w,s,h,t,z,m]) => ring(w,s,h,t,z,m));
  for (const side of [-1,1]) {
    box(.65, 7.4, 7.8, side * 5.72, 3.7, -3.3, plaster);
    box(.5,7.5,9,side*6.4,11.05,-3.3,plaster);
    box(.78, 1.35, 7.8, side * 5.7, .66, -3.3, ivory);
    box(.85, .14, 7.9, side * 5.68, 1.39, -3.3, gold);
    box(.8, .24, 7.8, side * 5.68, 7.34, -3.3, paintedGold);
    // Deep side niches, viewed obliquely, establish scale and genuine parallax.
    for (let j = 0; j < 3; j++) {
      const z = -.55 - j * 2.2;
      extrude(archOutline(.72,3.35,4.6,0),.04,blue,z,side*5.37,1.6,side*-Math.PI/2,.24);
      ring(.72, 3.35, 4.6, .13, z, paintedGold, .22, side * 5.32, 1.6, side * -Math.PI/2);
      ring(.9, 3.35, 4.81, .04, z, ivory, .25, side * 5.3, 1.6, side * -Math.PI/2);
    }
    // Recessed rectangular mosaics on the broad front piers.
    for (let row = 0; row < 3; row++) {
      const y = 3.25 + row * 4.75, x = side * 9.05;
      box(2.32, 3.55, .15, x, y, 1.22, paintedGold);
      box(2.1, 3.32, .08, x, y, 1.33, blue);
      for (const dx of [-1.18,1.18]) box(.06,3.7,.12,x+dx,y,1.38,ivory);
      for (const dy of [-1.85,1.85]) box(2.42,.06,.12,x,y+dy,1.38,gold);
    }
    // Turned columns and rope ornament articulate the threshold in relief.
    for (const x of [side*5.56,side*7.55]) {
      add(new T.CylinderGeometry(.14,.19,8.1,24),lapis,x,4.05,1.47);
      for (let k=0;k<70;k++) {
        const a=k*.65, yy=.3+k*.106;
        add(new T.SphereGeometry(.052,6,4),k%2?gold:ivory,x+Math.cos(a)*.155,yy,1.47+Math.sin(a)*.155);
      }
      for (const y of [.16,.36,7.82,8.02])add(new T.CylinderGeometry(.22,.22,.11,24),gold,x,y,1.47);
    }
  }
  // Rear wall: an open, deliberately generous doorway, separate panels and a carved crown.
  wall(5.5, 7.4, PORTAL.doorWidth, 4.1, PORTAL.doorHeight, PORTAL.rearZ, blue);
  // Upper infill sits behind the entire conch, not through its carved cells.
  box(14,7.3,.25,0,11.02,-7.45,plaster);
  ring(2.05,4.1,6.3,.12,-6.03,ivory,.3);
  ring(2.22,4.1,6.49,.37,-6.13,paintedGold,.22);
  ring(2.64,4.1,6.91,.1,-6.0,gold,.22);
  for (const side of [-1,1]) {
    for (let j=0;j<3;j++) {
      const x=side*(3.12+j*.72);
      box(.55,4.85,.12,x,3.83,-6.01,paintedGold);
      for (const dx of [-.3,.3])box(.035,4.96,.16,x+dx,3.83,-5.92,ivory);
    }
    box(2.7,1.35,.15,side*4.1,.65,-6.02,ivory);
  }
  // Short passage with a second opening; no endless texture tunnel.
  for (const z of [-8.8,-11.4]) {
    ring(2.12,4.2,6.45,.21,z,paintedGold,.4);
    ring(2.38,4.2,6.72,.07,z+.1,ivory,.4);
  }
  box(.4,6.6,7.4,-2.46,3.3,-10.4,plaster);box(.4,6.6,7.4,2.46,3.3,-10.4,plaster);
  box(5.3,.3,7.5,0,6.8,-10.4,paintedGold);
  wall(2.66,7.1,2.12,4.2,6.45,-14.3,plaster);
  // A sunlit courtyard arcade gives the far opening a tangible destination and scale.
  box(26,9,.6,0,4.5,-27,ivory);
  for(let x=-9;x<=9;x+=4.5){
    const panel=archOutline(1.25,3.3,5.4,0);
    extrude(panel,.06,blue,-26.62,x,.15);
    ring(1.28,3.3,5.45,.18,-26.53,paintedGold,.12,x,.15);
    ring(1.5,3.3,5.68,.06,-26.47,ivory,.1,x,.15);
  }
  box(26,.22,.8,0,8.55,-26.9,paintedGold);
  box(26,.13,.9,0,8.8,-26.9,ivory);
  // Actual stone paving, separate pieces with shallow joints.
  box(34,.18,46,0,-.15,-7,mortar);
  for(let x=-15;x<15;x+=1.5)for(let z=-28.5;z<15;z+=1.5){
    const g=mapSurface(new T.BoxGeometry(1.487,.08,1.487),.65),p=g.getAttribute('position'),uv=g.getAttribute('uv');
    const tone=.89+((Math.sin(x*27.4+z*13.6)+1)/2)*.11;
    const colors=new Float32Array(p.count*3);for(let i=0;i<p.count;i++){colors.set([tone,tone*.994,tone*.98],i*3);uv.setXY(i,uv.getX(i)+x*.39,uv.getY(i)+z*.61);}
    g.setAttribute('color',new T.BufferAttribute(colors,3));add(g,stone,x+.744,-.025,z+.744);
  }

  // A true half-dome conch of muqarnas: each tier wraps 180 degrees through the recess.
  // Vertices are shaded by cavity depth; the lip stays bright while the carved interior is recessed.
  const cellMat=own(new T.MeshStandardMaterial({color:'#c0a36e',map:gilding,roughness:.86,roughnessMap:plasterFinish.roughnessMap,normalMap:plasterFinish.normalMap,normalScale:new T.Vector2(.3,.3),metalness:.09,vertexColors:true,side:T.DoubleSide}));
  const cellGeometries:T.BufferGeometry[]=[], outlineGeometries:T.BufferGeometry[]=[];
  for(let tier=0;tier<12;tier++) {
    const t=tier/12,r=5.32*Math.sqrt(1-t*t),y=7.45+tier*.48;
    const count=Math.round(Math.PI*r/.46),width=Math.PI*r/count;
    for(let i=0;i<count;i++) {
      const a=(i+.5)*Math.PI/count,angle=a-Math.PI/2;
      const matrix=new T.Matrix4().makeRotationY(angle);matrix.setPosition(r*Math.cos(a),y,-.75-r*Math.sin(a));
      const h=.47,d=.38;
      const edge=[new T.Vector3(width/2,0,0)];
      for(let j=0;j<=10;j++){const q=j*Math.PI/10;edge.push(new T.Vector3(Math.cos(q)*width/2,h*.23+Math.sin(q)*h*.77,0));}
      edge.push(new T.Vector3(-width/2,0,0));
      const inner=new T.Vector3(0,h*.38,-d),positions:number[]=[],uvs:number[]=[],colors:number[]=[];
      for(let j=0;j<edge.length-1;j++) {
        const points=[edge[j],edge[j+1],inner];
        for(let k=0;k<3;k++){
          const p=points[k];positions.push(p.x,p.y,p.z);uvs.push((p.x/width+.5)*.06+.42,p.y/h*.09+.4);
          const shade=k===2?.22:.86;colors.push(shade,shade,shade);
        }
      }
      const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));g.setAttribute('color',new T.Float32BufferAttribute(colors,3));g.computeVertexNormals();g.applyMatrix4(matrix);cellGeometries.push(g);
      const curve=new T.CatmullRomCurve3(edge);const lip=new T.TubeGeometry(curve,20,.012,5,false);lip.applyMatrix4(matrix);outlineGeometries.push(lip);
      // Alternating suspended diamond tips break the straight shelf silhouette.
      if((i+tier)%2===0){const drop=new T.ConeGeometry(width*.22,.24,4);drop.rotateZ(Math.PI);drop.translate(width/2,-.06,-.02);drop.applyMatrix4(matrix);outlineGeometries.push(drop);}
    }
  }
  const cells=mergeGeometries(cellGeometries); if(cells){own(cells);const m=new T.Mesh(cells,cellMat);m.castShadow=m.receiveShadow=true;scene.add(m);}cellGeometries.forEach(g=>g.dispose());
  const lips=mergeGeometries(outlineGeometries);if(lips)add(lips,ivory);outlineGeometries.forEach(g=>g.dispose());
  // Half dome behind the cells seals the canopy; it never descends into the aisle.
  const vault=new T.SphereGeometry(6.1,64,32,0,Math.PI,0,Math.PI/2);
  vault.scale(1,1.13,1);vault.rotateY(Math.PI);mapSurface(vault,.32);
  const vaultMat=own(paintedGold.clone());vaultMat.side=T.BackSide;
  add(vault,vaultMat,0,7.4,-.75);
  // Close the deep arch soffit above the conch; no sky slivers between structural orders.
  const profile=archOutline(5.51,8,14).getPoints(64).filter(p=>p.y>=8);
  const roofPositions:number[]=[],roofUV:number[]=[];
  let distance=0;
  for(let i=0;i<profile.length-1;i++){
    const a=profile[i],b=profile[i+1],next=distance+a.distanceTo(b);
    for(const [p,z,u] of [[a,.65,distance],[a,-7,distance],[b,-7,next],[a,.65,distance],[b,-7,next],[b,.65,next]] as [T.Vector2,number,number][]){roofPositions.push(p.x,p.y,z);roofUV.push(u*.32,z*.32);}
    distance=next;
  }
  const roof=new T.BufferGeometry();roof.setAttribute('position',new T.Float32BufferAttribute(roofPositions,3));roof.setAttribute('uv',new T.Float32BufferAttribute(roofUV,2));roof.computeVertexNormals();
  const roofMaterial=own(blue.clone());roofMaterial.side=T.DoubleSide;add(roof,roofMaterial);
  // Fine geometric star inlays at the arch spandrels.
  for(const side of [-1,1])for(const yy of [9.6,12.2,15.8]){
    const x=side*(yy>14?8:8.7),s=new T.Shape();
    for(let k=0;k<16;k++){const a=k*Math.PI/8,r=k%2?.28:.49;k?s.lineTo(Math.cos(a)*r,Math.sin(a)*r):s.moveTo(Math.cos(a)*r,Math.sin(a)*r);}s.closePath();
    extrude(s,.035,gold,1.48,x,yy);add(new T.CircleGeometry(.17,32),turquoise,x,yy,1.54);
  }
  for(const [material,geometries] of batches) {
    // Mixed indexed/non-indexed source geometries are normalized before merging.
    const normalized=geometries.map(g=>g.index?g.toNonIndexed():g);
    const g=mergeGeometries(normalized);if(g){own(g);const m=new T.Mesh(g,material);m.castShadow=m.receiveShadow=true;scene.add(m);}
    normalized.forEach(g=>g.dispose());geometries.forEach(g=>g.dispose());
  }
  const envScene=new RoomEnvironment(),pmrem=new T.PMREMGenerator(renderer);
  const environment=own(pmrem.fromScene(envScene,.04));scene.environment=environment.texture;scene.environmentIntensity=.15;envScene.dispose();pmrem.dispose();
  const hemisphere=new T.HemisphereLight('#d9e6f0','#655848',.29);scene.add(hemisphere);
  const sun=new T.DirectionalLight('#ffe1b0',2.05);sun.position.set(-10,15,13);sun.target.position.set(0,7,-5);sun.castShadow=true;
  sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-15,right:15,top:20,bottom:-10,near:1,far:55});sun.shadow.normalBias=.018;sun.shadow.bias=-.0001;sun.shadow.radius=3;scene.add(sun,sun.target);
  const bounce=new T.PointLight('#f3dfbd',13,25,2);bounce.position.set(2,7,0);scene.add(bounce);
  const exitLight=new T.PointLight('#d6e5eb',32,22,2);exitLight.position.set(0,3,-13);scene.add(exitLight);
  scene.updateMatrixWorld(true);
  return ()=>{resources.forEach(r=>r.dispose());sun.shadow.map?.dispose();scene.environment=null;scene.clear();};
}
