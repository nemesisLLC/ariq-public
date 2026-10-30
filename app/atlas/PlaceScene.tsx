'use client';
import {useEffect,useLayoutEffect,useMemo,useRef} from 'react';
import {useFrame,useThree} from '@react-three/fiber';
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {lonLatToWorld,worldToLonLat,elevationToWorld,type LonLat} from './geo';
import {gridSampler,buildRibbon,type ReliefData,type WaterFeature} from './terrain';
import type {CameraTier} from './ReliefScene';
import {artifactSurface,RELIEF_HEIGHT_SCALE,clippedWater,insideRelief} from './artifactGeometry';
import {indexTerrainPicking,acceleratedRaycast} from './terrainPicking';

export const elevation=(metres:number)=>elevationToWorld(metres)*RELIEF_HEIGHT_SCALE;
export type Focus={coordinate:LonLat;distance?:number;key:number};
export type Region={id:string;nameEn:string;nameSource:string;nameRu:string;centre:{latitude:number;longitude:number};polygon:LonLat[][]};
export type Layers={rivers:boolean;canals:boolean;reservoirs:boolean;cities:boolean;regions:boolean};
export type Place={name?:string;kind?:string;coordinate:LonLat;capacity?:number|null};

export function AtlasControls({data,focus,reset,zoom,onTier,onLocal,onHeading}:{data:ReliefData;focus:Focus|null;reset:number;zoom:{key:number;factor:number};onTier:(tier:CameraTier)=>void;onLocal:(p:LonLat)=>void;onHeading:(heading:number)=>void}) {
  const {camera,gl,size,invalidate}=useThree();
  const controls=useRef<OrbitControls|null>(null);
  const goal=useRef<{target:THREE.Vector3;distance:number;home?:boolean}|null>(null);
  const lastTier=useRef<CameraTier>('national'),entered=useRef(false);
  const reduced=useRef(false);
  const scratch=useMemo(()=>({direction:new THREE.Vector3(),position:new THREE.Vector3(),origin:new THREE.Vector3(),north:new THREE.Vector3()}),[]);
  useEffect(()=>{const media=matchMedia('(prefers-reduced-motion: reduce)'),update=()=>{reduced.current=media.matches;};update();media.addEventListener('change',update);return()=>media.removeEventListener('change',update);},[]);
  const home=useMemo(()=>{
    const aspect=size.width/size.height,portrait=aspect<.85;
    const direction=new THREE.Vector3(portrait?-.3:-.13,portrait?.95:.79,portrait?.02:.6).normalize();
    const right=new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),direction).normalize(),up=new THREE.Vector3().crossVectors(direction,right).normalize();
    let distance=portrait?48:38.5;const tangent=Math.tan(38*Math.PI/360),point=new THREE.Vector3();
    // Fit actual source vertices to the viewport; no hand-tuned crop or geographic deformation.
    for(let i=0;i<data.positions.length;i+=3){point.set(data.positions[i],data.positions[i+1]*RELIEF_HEIGHT_SCALE,data.positions[i+2]-.4);const depth=point.dot(direction);distance=Math.max(distance,depth+Math.abs(point.dot(right))/(tangent*aspect*.87),depth+Math.abs(point.dot(up))/(tangent*(portrait?.65:.77)));}
    return {direction,distance};
  },[size.width,size.height,data]);
  const homeDistance=home.distance;
  useEffect(()=>{
    const c=new OrbitControls(camera,gl.domElement);c.enableDamping=true;c.dampingFactor=.085;c.minDistance=5;c.maxDistance=180;c.maxPolarAngle=1.35;c.minPolarAngle=.2;
    c.target.set(0,0,.4);camera.position.copy(home.direction).multiplyScalar(homeDistance).add(c.target);c.update();camera.updateMatrixWorld();
    if(!matchMedia('(prefers-reduced-motion: reduce)').matches){camera.position.multiplyScalar(1.035);goal.current={target:c.target.clone(),distance:homeDistance,home:true};invalidate();}
    const changed=()=>invalidate(),start=()=>{goal.current=null;};c.addEventListener('change',changed);c.addEventListener('start',start);controls.current=c;
    return()=>{c.removeEventListener('change',changed);c.removeEventListener('start',start);c.dispose();controls.current=null;};
  },[camera,gl,homeDistance,home,invalidate]);
  useEffect(()=>{if(focus){const [x,z]=lonLatToWorld(...focus.coordinate);goal.current={target:new THREE.Vector3(x,.25,z),distance:focus.distance??13};invalidate();}},[focus,invalidate]);
  useEffect(()=>{if(reset){goal.current={target:new THREE.Vector3(0,0,.4),distance:homeDistance,home:true};invalidate();}},[reset,homeDistance,invalidate]);
  useEffect(()=>{const c=controls.current;if(c&&zoom.key){goal.current={target:c.target.clone(),distance:THREE.MathUtils.clamp(camera.position.distanceTo(c.target)*zoom.factor,5,180)};invalidate();}},[zoom,camera,invalidate]);
  useFrame((_,delta)=>{
    const c=controls.current;if(!c)return;
    const g=goal.current;
    if(g){const alpha=reduced.current?1:1-Math.exp(-5*Math.min(.1,delta));
      c.target.lerp(g.target,alpha);
      const direction=g.home?home.direction:scratch.direction.copy(camera.position).sub(c.target).normalize();
      const position=scratch.position.copy(g.target).addScaledVector(direction,g.distance);camera.position.lerp(position,alpha);
      if(camera.position.distanceTo(position)<.025&&c.target.distanceTo(g.target)<.025)goal.current=null;else invalidate();
    }
    c.update();const distance=c.target.distanceTo(camera.position),tier:CameraTier=distance>29?'national':distance>13?'regional':'local';
    const origin=scratch.origin.copy(c.target).project(camera),north=scratch.north.copy(c.target);north.z-=1;north.project(camera);
    onHeading(Math.atan2((north.x-origin.x)*size.width,(north.y-origin.y)*size.height));
    if(tier!==lastTier.current){lastTier.current=tier;onTier(tier);}
    // Crossing a geographic threshold hands off the actual control target, never screen coordinates.
    if(distance<6&&!entered.current){entered.current=true;onLocal(worldToLonLat(c.target.x,c.target.z));}
    if(distance>10)entered.current=false;
  });return null;
}

export function CarvedTerrain({data,onSelect,onFocus}:{data:ReliefData;onSelect:(p:Place)=>void;onFocus:(p:LonLat)=>void}) {
  // Fine, neutral ceramic grain changes only the finish, never mapped relief.
  const grain=useMemo(()=>{const pixels=new Uint8Array(128*128*4);let seed=713;for(let i=0;i<pixels.length;i+=4){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const value=175+(seed%65);pixels.set([value,value,value,255],i);}const texture=new THREE.DataTexture(pixels,128,128);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.generateMipmaps=true;texture.anisotropy=8;texture.needsUpdate=true;return texture;},[]);
  const geometry=useMemo(()=>{
    const g=new THREE.BufferGeometry(),surface=artifactSurface(data),positions=surface.positions,colors=new Float32Array(positions.length);
    const low=new THREE.Color('#969b84'),high=new THREE.Color('#e7dac0'),rock=new THREE.Color('#bdb79e');
    for(let i=0;i<positions.length/3;i++){
      const y=positions[i*3+1],height=Math.max(0,y/.32);
      const c=height<.35?low.clone().lerp(rock,height/.35):rock.clone().lerp(high,Math.min(1,(height-.35)/.65));colors.set([c.r,c.g,c.b],i*3);
    }
    g.setAttribute('position',new THREE.BufferAttribute(positions,3));g.setAttribute('color',new THREE.BufferAttribute(colors,3));g.setIndex(new THREE.BufferAttribute(surface.indices,1));g.addGroup(0,surface.topIndexCount,0);g.addGroup(surface.topIndexCount,surface.indices.length-surface.topIndexCount,1);g.computeVertexNormals();
    const normal=g.getAttribute('normal'),sample=gridSampler(data.elevations,data.gridW,data.gridH),epsilon=.035;
    for(let i=0;i<surface.sourceVertexCount;i++){
      const x=positions[i*3],z=positions[i*3+2],left=worldToLonLat(x-epsilon,z),right=worldToLonLat(x+epsilon,z),north=worldToLonLat(x,z-epsilon),south=worldToLonLat(x,z+epsilon);
      const n=new THREE.Vector3(-(elevation(sample(...right))-elevation(sample(...left)))/(2*epsilon),1,-(elevation(sample(...south))-elevation(sample(...north)))/(2*epsilon)).normalize();normal.setXYZ(i,n.x,n.y,n.z);
    }
    // Equal-weight perimeter normals avoid shading spikes caused by the very
    // unequal triangle sizes where the exact boundary intersects the DEM grid.
    const sideNormals=new Map<number,THREE.Vector3>(),next=new Map<number,number>(),previous=new Map<number,number>();
    for(const {a,b} of surface.boundary){next.set(a,b);previous.set(b,a);}
    for(const {a,b} of surface.boundary){const dx=positions[b*3]-positions[a*3],dz=positions[b*3+2]-positions[a*3+2],n=new THREE.Vector3(-dz,0,dx).normalize();for(const i of [a,b]){const sum=sideNormals.get(i)??new THREE.Vector3();sum.add(n);sideNormals.set(i,sum);}}
    // Follow a short physical arc on each side rather than a fixed vertex
    // count: border intersections can be micrometres apart in model space.
    // Only shading normals are filtered; no boundary position is moved.
    const along=(start:number,links:Map<number,number>)=>{let index=start,distance=0;for(let step=0;step<160;step++){const other=links.get(index);if(other===undefined||other===start)break;const length=Math.hypot(positions[other*3]-positions[index*3],positions[other*3+2]-positions[index*3+2]);if(distance+length>=.22){const t=(.22-distance)/length;return new THREE.Vector2(THREE.MathUtils.lerp(positions[index*3],positions[other*3],t),THREE.MathUtils.lerp(positions[index*3+2],positions[other*3+2],t));}distance+=length;index=other;}return new THREE.Vector2(positions[index*3],positions[index*3+2]);};
    for(const [i,n] of sideNormals){const a=along(i,previous),b=along(i,next);n.set(a.y-b.y,0,b.x-a.x).normalize();for(const vertex of [surface.shoulder.get(i)!,surface.foot.get(i)!])normal.setXYZ(vertex,n.x,n.y,n.z);const upper=new THREE.Vector3().fromBufferAttribute(normal,i).multiplyScalar(.65).addScaledVector(n,.35).normalize(),bottom=n.clone().add(new THREE.Vector3(0,-.65,0)).normalize();normal.setXYZ(surface.sideTop.get(i)!,upper.x,upper.y,upper.z);normal.setXYZ(surface.lower.get(i)!,bottom.x,bottom.y,bottom.z);}
    const uv=new Float32Array(positions.length/3*2);
    for(let i=0;i<positions.length/3;i++){const isSide=i>=surface.sourceVertexCount&&i<surface.bottomOffset;uv[i*2]=isSide?(positions[i*3]+positions[i*3+2])*2:positions[i*3]*2;uv[i*2+1]=isSide?positions[i*3+1]*2:positions[i*3+2]*2;}
    g.setAttribute('uv',new THREE.BufferAttribute(uv,2));
    // Index the exact triangles. Indirect mode preserves the original geographic
    // vertex/index buffers, material groups and reported face indices.
    indexTerrainPicking(g);
    return g;
  },[data]);
  useEffect(()=>{indexTerrainPicking(geometry);return()=>{delete geometry.boundsTree;geometry.dispose();grain.dispose();};},[geometry,grain]);
  return <mesh geometry={geometry} raycast={acceleratedRaycast} castShadow onPointerOver={()=>{document.body.style.cursor='crosshair';}} onPointerOut={()=>{document.body.style.cursor='';}} onClick={e=>{if(e.delta>5)return;e.stopPropagation();onSelect({coordinate:worldToLonLat(e.point.x,e.point.z)});}} onDoubleClick={e=>{e.stopPropagation();onFocus(worldToLonLat(e.point.x,e.point.z));}}>
    <meshPhysicalMaterial attach="material-0" vertexColors roughness={.82} roughnessMap={grain} bumpMap={grain} bumpScale={.006} metalness={.03} clearcoat={.12} clearcoatRoughness={.6}/>
    <meshPhysicalMaterial attach="material-1" color="#817c6b" roughness={.82} roughnessMap={grain} bumpMap={grain} bumpScale={.003} metalness={.03} clearcoat={.16} clearcoatRoughness={.55}/>
  </mesh>;
}

export function WaterRibbons({data,features,width,color}:{data:ReliefData;features:WaterFeature[];width:number;color:string}) {
  const material=useRef<THREE.MeshStandardMaterial|null>(null),reduced=useRef<MediaQueryList|null>(null);
  useEffect(()=>{reduced.current=matchMedia('(prefers-reduced-motion: reduce)');},[]);
  useFrame(({clock})=>{if(material.current)material.current.emissiveIntensity=reduced.current?.matches ? .2 : .2+.07*Math.sin(clock.elapsedTime*Math.PI*2/7);});
  const geometry=useMemo(()=>{
    const c=new THREE.Color(color);
    // buildRibbon consumes lon/lat; lift and relief display scale must match the terrain.
    const real=buildRibbon(clippedWater(data,features),width,[c.r,c.g,c.b],gridSampler(data.elevations,data.gridW,data.gridH),.022);
    for(let i=1;i<real.positions.length;i+=3)real.positions[i]=(real.positions[i]-.022)*RELIEF_HEIGHT_SCALE+.022;
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(real.positions,3));g.setIndex(new THREE.BufferAttribute(real.indices,1));g.computeVertexNormals();return g;
  },[data,features,width,color]);
  useEffect(()=>()=>geometry.dispose(),[geometry]);
  return <mesh geometry={geometry}><meshStandardMaterial ref={material} color={color} emissive="#3192a3" emissiveIntensity={.2} roughness={.3} metalness={.25} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={-1}/></mesh>;
}

function labelSprite(name:string) {
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=100;const c=canvas.getContext('2d')!;
  c.font='600 42px Arial';c.textAlign='center';c.textBaseline='middle';c.shadowColor='#19393b';c.shadowBlur=5;c.fillStyle='#fff4dc';c.fillText(name,256,50);
  const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;const material=new THREE.SpriteMaterial({map,depthWrite:false,depthTest:false,toneMapped:false});const sprite=new THREE.Sprite(material);sprite.scale.set(4.8,.94,1);return sprite;
}

export function CityLandmarks({data,tier,language,onSelect}:{data:ReliefData;tier:CameraTier;language:string;onSelect:(p:Place)=>void}) {
  const models=useRef<(THREE.Group|null)[]>([]);
  const scratch=useMemo(()=>({position:new THREE.Vector3(),projected:new THREE.Vector3()}),[]);
  const translations:Record<string,string[]>={Tashkent:['Toshkent','Ташкент'],Samarkand:['Samarqand','Самарканд'],Bukhara:['Buxoro','Бухара'],Fergana:['Farg‘ona','Фергана'],Andijan:['Andijon','Андижан'],Namangan:['Namangan','Наманган'],Nukus:['Nukus','Нукус'],Qarshi:['Qarshi','Карши'],Termez:['Termiz','Термез'],Jizzakh:['Jizzax','Джизак'],Guliston:['Guliston','Гулистан'],Navoiy:['Navoiy','Навои'],Urgench:['Urganch','Ургенч'],Nurafshon:['Nurafshon','Нурафшан']};
  const cities=useMemo(()=>{
    const sample=gridSampler(data.elevations,data.gridW,data.gridH);
    return data.cities.filter(c=>tier!=='national'||['Tashkent','Samarkand','Bukhara','Nukus','Fergana','Termez','Urgench','Qarshi'].includes(c.name)).map(c=>{
      const name=language==='en'?c.name:translations[c.name]?.[language==='uz'?0:1]??c.name;
      const [x,z]=lonLatToWorld(c.lon,c.lat),sprite=labelSprite(name);sprite.position.set(0,.89,0);return {...c,name,x,z,y:elevation(sample(c.lon,c.lat)),sprite};
    });
  },[data,tier,language]);
  useEffect(()=>()=>cities.forEach(c=>{const m=c.sprite.material as THREE.SpriteMaterial;m.map?.dispose();m.dispose();}),[cities]);
  useFrame(({camera,size})=>{
    camera.updateMatrixWorld();
    const accepted:{x:number;y:number;width:number}[]=[];
    cities.forEach((c,i)=>{
      const scale=THREE.MathUtils.clamp(camera.position.distanceTo(scratch.position.set(c.x,c.y,c.z))/38.5,.18,1.3);
      c.sprite.scale.set(4.8*scale,.94*scale,1);c.sprite.position.y=.32*scale+.1;models.current[i]?.scale.setScalar(Math.max(.3,Math.min(1.05,scale)));
      const projected=scratch.projected.set(c.x,c.y+c.sprite.position.y,c.z).project(camera),x=(projected.x+1)*size.width/2,y=(1-projected.y)*size.height/2,width=Math.max(65,c.name.length*8);
      const visible=projected.z<1&&projected.z>-1&&x>0&&x<size.width&&y>85&&y<size.height-100&&!accepted.some(p=>Math.abs(p.x-x)<(p.width+width)/2&&Math.abs(p.y-y)<25);
      c.sprite.visible=visible;if(visible)accepted.push({x,y,width});
    });
  });
  return <group>{cities.map((c,i)=><group key={c.name} position={[c.x,c.y+.02,c.z]} onClick={e=>{e.stopPropagation();onSelect({name:c.name,kind:'city',coordinate:[c.lon,c.lat]});}} onPointerOver={()=>{document.body.style.cursor='pointer';}} onPointerOut={()=>{document.body.style.cursor='';}}>
    <group ref={element=>{models.current[i]=element;}} scale={tier==='national'?1.1:.9}>
      <mesh rotation={[-Math.PI/2,0,0]} position={[0,.012,0]}><ringGeometry args={[.06,.085,24]}/><meshBasicMaterial color="#244f55" side={THREE.DoubleSide}/></mesh>
    </group>
    <primitive object={c.sprite}/>
  </group>)}</group>;
}

export function WaterMarkers({data,onSelect}:{data:ReliefData;onSelect:(p:Place)=>void}) {
  const mesh=useRef<THREE.InstancedMesh>(null!);
  const features=useMemo(()=>data.reservoirs.filter(f=>insideRelief(data,...f.geometry.coordinates as LonLat)),[data]);
  useEffect(()=>{
    const sample=gridSampler(data.elevations,data.gridW,data.gridH),m=new THREE.Matrix4(),q=new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI/2,0,0));
    features.forEach((f,i)=>{const [lon,lat]=f.geometry.coordinates,[x,z]=lonLatToWorld(lon,lat),scale=.055;m.compose(new THREE.Vector3(x,elevation(sample(lon,lat))+.035,z),q,new THREE.Vector3(scale,scale,scale));mesh.current.setMatrixAt(i,m);});mesh.current.instanceMatrix.needsUpdate=true;
  },[data,features]);
  return <instancedMesh ref={mesh} args={[undefined,undefined,features.length]} onClick={e=>{if(e.instanceId===undefined)return;e.stopPropagation();const f=features[e.instanceId];onSelect({coordinate:f.geometry.coordinates,name:f.properties.name,kind:f.properties.kind,capacity:f.properties.designTotalMillionM3});}}><ringGeometry args={[.55,1,24]}/><meshStandardMaterial color="#62acb3" emissive="#2a6273" emissiveIntensity={.4} roughness={.3} side={THREE.DoubleSide}/></instancedMesh>;
}

export function DamMarkers({data,onSelect}:{data:ReliefData;onSelect:(p:Place)=>void}) {
  const mesh=useRef<THREE.InstancedMesh>(null!);
  const features=useMemo(()=>data.dams.filter(f=>insideRelief(data,...f.geometry.coordinates as LonLat)),[data]);
  useLayoutEffect(()=>{const sample=gridSampler(data.elevations,data.gridW,data.gridH),matrix=new THREE.Matrix4();features.forEach((f,i)=>{const [lon,lat]=f.geometry.coordinates,[x,z]=lonLatToWorld(lon,lat);matrix.makeTranslation(x,elevation(sample(lon,lat))+.06,z);mesh.current.setMatrixAt(i,matrix);});mesh.current.instanceMatrix.needsUpdate=true;mesh.current.computeBoundingSphere();},[data,features]);
  return <instancedMesh ref={mesh} args={[undefined,undefined,features.length]} castShadow onClick={e=>{if(e.instanceId===undefined)return;e.stopPropagation();const f=features[e.instanceId];onSelect({coordinate:f.geometry.coordinates as LonLat,name:f.properties.name,kind:'dam'});}}><boxGeometry args={[.16,.09,.055]}/><meshStandardMaterial color="#b49d6e" roughness={.65} metalness={.25}/></instancedMesh>;
}

export function RegionLines({regions,data}:{regions:Region[];data:ReliefData}) {
  const object=useMemo(()=>{
    const group=new THREE.Group(),sample=gridSampler(data.elevations,data.gridW,data.gridH);
    regions.forEach(r=>r.polygon.forEach(ring=>{
      const points=ring.filter((_,i)=>i%3===0).map(p=>{const [x,z]=lonLatToWorld(...p);return new THREE.Vector3(x,elevation(sample(...p))+.04,z);});
      if(points.length>2)group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:'#7d755a',transparent:true,opacity:.4})));}));return group;
  },[regions,data]);
  useEffect(()=>()=>object.traverse(o=>{if(o instanceof THREE.Line){o.geometry.dispose();(o.material as THREE.Material).dispose();}}),[object]);return <primitive object={object}/>;
}
