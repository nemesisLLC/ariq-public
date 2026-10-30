'use client';
import {useMemo,useEffect,useLayoutEffect} from 'react';
import {Canvas,useThree} from '@react-three/fiber';
import * as THREE from 'three';
import {AtlasControls,CarvedTerrain,CityLandmarks,WaterMarkers,DamMarkers,WaterRibbons,RegionLines,elevation,type Focus,type Layers,type Place,type Region} from './PlaceScene';
import {gridSampler,type ReliefData} from './terrain';
import {lonLatToWorld,type LonLat} from './geo';
export type CameraTier='national'|'regional'|'local';

export default function ReliefScene({data,selected,tier,onTier,onSelect,onLocal,resetSignal,focus,zoom,layers,regions,language,onFailure,onHeading}:{data:ReliefData;selected:LonLat|null;tier:CameraTier;onTier:(t:CameraTier)=>void;onSelect:(p:Place)=>void;onLocal:(p:LonLat)=>void;resetSignal:number;focus:Focus|null;zoom:{key:number;factor:number};layers:Layers;regions:Region[];language:string;onFailure:()=>void;onHeading:(heading:number)=>void}) {
  const marker=useMemo(()=>{
    if(!selected)return null;const [x,z]=lonLatToWorld(...selected);return [x,elevation(gridSampler(data.elevations,data.gridW,data.gridH)(...selected))+.04,z] as [number,number,number];
  },[selected,data]);
  // Country view deliberately limits the density; finer mapped canals appear on approach.
  const displayLength=(feature:ReliefData['rivers'][number])=>{const points=feature.geometry.coordinates as number[][];return points.slice(1).reduce((sum,p,i)=>sum+Math.hypot((p[0]-points[i][0])*.75,p[1]-points[i][1]),0);};
  const nationalRivers=useMemo(()=>data.rivers.filter(f=>/amu|syr|sird|zaraf|zarav|chirchi|qashq|kashk|surkh|surx|karad|qorad|naryn|norin|Амудар|Сырдар|Зараф|Чирчи|Сурх|Кашк|Нарын/i.test(f.properties.name??'')||displayLength(f)>.45),[data]);
  const nationalCanals=useMemo(()=>data.canalsMajor.filter(f=>displayLength(f)>.3),[data]);
  return <Canvas frameloop="demand" shadows="variance" dpr={[1,1.5]} camera={{position:[1,31,26],fov:38,near:.5,far:180}} gl={{antialias:true,powerPreference:'high-performance'}} onCreated={({gl})=>{gl.toneMapping=THREE.ACESFilmicToneMapping;gl.toneMappingExposure=1.05;gl.domElement.addEventListener('webglcontextlost',onFailure,{once:true});}} fallback={<div className="a-canvas-fallback" role="status">3D unavailable</div>}>
    <color attach="background" args={['#cec7b7']}/>
    <hemisphereLight args={['#e7f0ef','#7d684b',1.0]}/>
    <directionalLight position={[-14,24,-14]} intensity={2.3} color="#fff5e1" castShadow shadow-mapSize={[2048,2048]} shadow-camera-left={-26} shadow-camera-right={26} shadow-camera-top={23} shadow-camera-bottom={-23} shadow-camera-near={1} shadow-camera-far={85} shadow-bias={-.00025} shadow-normalBias={.018} shadow-radius={2.5} shadow-blurSamples={8}/>
    <directionalLight position={[22,11,-5]} color="#76acb7" intensity={.65}/>
    <directionalLight position={[0,8,24]} color="#a6b7be" intensity={1.2}/>
    <spotLight position={[-4,19,9]} angle={1.02} penumbra={1} intensity={80} distance={65} decay={2} color="#9bafab"/>
    <mesh position={[0,-1.18,0]} rotation={[-Math.PI/2,0,0]}><planeGeometry args={[300,300]}/><shaderMaterial toneMapped={false} uniforms={{center:{value:new THREE.Color('#e9e2d2')},edge:{value:new THREE.Color('#cec7b7')}}} vertexShader={'varying vec2 vFloor; void main(){vFloor=position.xy;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}'} fragmentShader={'varying vec2 vFloor; uniform vec3 center; uniform vec3 edge; void main(){float pool=exp(-dot(vFloor/vec2(29.0,23.0),vFloor/vec2(29.0,23.0))*1.5);gl_FragColor=vec4(mix(edge,center,pool),1.0);\n#include <colorspace_fragment>\n}'}/></mesh>
    <mesh position={[0,-1.17,0]} rotation={[-Math.PI/2,0,0]} receiveShadow><planeGeometry args={[110,110]}/><shadowMaterial opacity={.25} transparent/></mesh>
    <StaticAtlasShadows data={data} reservoirs={layers.reservoirs}/>

    <CarvedTerrain data={data} onSelect={onSelect} onFocus={p=>onSelect({coordinate:p,kind:'focus'})}/>
    {(layers.rivers||layers.canals)&&<WaterLightRhythm/>}
    {layers.rivers&&<WaterRibbons data={data} features={tier==='national'?nationalRivers:data.rivers} width={tier==='national'?.075:.032} color="#4ac5d8"/>}
    {layers.canals&&<WaterRibbons data={data} features={tier==='national'?nationalCanals:data.canalsMajor} width={tier==='national'?.044:.022} color="#4bc1cc"/>}
    {layers.canals&&tier!=='national'&&<WaterRibbons data={data} features={data.canalsMinor} width={.012} color="#639e98"/>}
    {layers.reservoirs&&<WaterMarkers data={data} onSelect={onSelect}/>}
    {layers.reservoirs&&<DamMarkers data={data} onSelect={onSelect}/>}
    {layers.cities&&<CityLandmarks data={data} tier={tier} language={language} onSelect={onSelect}/>}
    {layers.regions&&<RegionLines regions={regions} data={data}/>}
    {marker&&<group position={marker}><mesh position={[0,.55,0]}><cylinderGeometry args={[.018,.018,1.1,8]}/><meshStandardMaterial color="#9b7538"/></mesh><mesh position={[0,1.12,0]}><sphereGeometry args={[.13,16,12]}/><meshStandardMaterial color="#173e50" metalness={.25} roughness={.35}/></mesh><mesh rotation={[-Math.PI/2,0,0]}><ringGeometry args={[.19,.23,32]}/><meshBasicMaterial color="#a08048" side={THREE.DoubleSide}/></mesh></group>}
    <AtlasControls data={data} focus={focus} reset={resetSignal} zoom={zoom} onTier={onTier} onLocal={onLocal} onHeading={onHeading}/>
  </Canvas>;
}

// Camera motion, label scaling and emissive water do not move any shadow caster.
// Rebuild only when the terrain or the visible dam layer actually changes.
function StaticAtlasShadows({data,reservoirs}:{data:ReliefData;reservoirs:boolean}){
  const gl=useThree(state=>state.gl),invalidate=useThree(state=>state.invalidate);
  useLayoutEffect(()=>{gl.shadowMap.autoUpdate=false;gl.shadowMap.needsUpdate=true;invalidate();},[gl,invalidate,data,reservoirs]);
  return null;
}

/** Slow light variation only; preserve the actual water geometry and color. */
function WaterLightRhythm(){
  const invalidate=useThree(state=>state.invalidate),get=useThree(state=>state.get);
  useEffect(()=>{const reduced=matchMedia('(prefers-reduced-motion: reduce)');const redraw=()=>invalidate();reduced.addEventListener('change',redraw);const timer=setInterval(()=>{if(!reduced.matches&&document.visibilityState==='visible'&&get().internal.frames===0)invalidate();},80);return()=>{clearInterval(timer);reduced.removeEventListener('change',redraw);};},[invalidate,get]);
  return null;
}
