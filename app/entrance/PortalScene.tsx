'use client';
import { useEffect, useRef } from 'react';
import * as T from 'three';
import { gsap } from 'gsap';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildArchitecture } from './architecture';
import { createJourney, JOURNEY_SECONDS } from './journey';
type Props={entering:boolean;reduced:boolean;onReady:()=>void;onDone:()=>void;onError:()=>void};
export default function PortalScene(props:Props){
  const host=useRef<HTMLDivElement>(null),latest=useRef(props),enter=useRef<(()=>void)|null>(null);latest.current=props;
  useEffect(()=>{
    const mount=host.current;if(!mount)return;const node:HTMLDivElement=mount;
    let renderer:T.WebGLRenderer|undefined,release:(()=>void)|undefined,resize:ResizeObserver|undefined;
    let composer:EffectComposer|undefined,ao:SSAOPass|undefined;
    let frame=0,dead=false,travel=false,timeline:gsap.core.Timeline|undefined;
    let journey=createJourney(false);const animation={progress:0};
    const scene=new T.Scene();scene.background=new T.Color('#cbd7d6');scene.fog=new T.Fog('#cbd7d6',40,80);
    const camera=new T.PerspectiveCamera(56,1,.06,75);
    const pointer={x:0,y:0},offset={x:0,y:0};let mobile=false;
    const draw=()=>{
      frame=0;if(dead||document.hidden||!renderer)return;
      const px=travel||latest.current.reduced?0:pointer.x,py=travel||latest.current.reduced?0:pointer.y;
      offset.x+=(px-offset.x)*.085;offset.y+=(py-offset.y)*.085;
      const shot=journey(travel?animation.progress:0);
      camera.position.copy(shot.eye).add(new T.Vector3(offset.x*.22,offset.y*.1,0));
      camera.lookAt(shot.look.x+offset.x*.07,shot.look.y+offset.y*.05,shot.look.z);
      node.parentElement?.style.setProperty('--threshold',String(shot.threshold));
      try{const began=performance.now();renderer.info.reset();if(composer)composer.render();else renderer.render(scene,camera);if(process.env.NODE_ENV==='development')node.dataset.renderStats=JSON.stringify({triangles:renderer.info.render.triangles,drawCalls:renderer.info.render.calls,drawMilliseconds:Math.round((performance.now()-began)*10)/10});}catch{latest.current.onError();return;}
      if(Math.abs(px-offset.x)+Math.abs(py-offset.y)>.0005)frame=requestAnimationFrame(draw);
    };
    const requestDraw=()=>{if(!frame&&!dead)frame=requestAnimationFrame(draw);};
    const move=(e:PointerEvent)=>{if(travel||latest.current.reduced||e.pointerType==='touch')return;const r=node.getBoundingClientRect();pointer.x=(e.clientX-r.left)/r.width*2-1;pointer.y=1-(e.clientY-r.top)/r.height*2;requestDraw();};
    const leave=()=>{pointer.x=pointer.y=0;requestDraw();};
    const visibility=()=>{if(document.hidden){timeline?.pause();cancelAnimationFrame(frame);frame=0;}else{if(travel)timeline?.resume();requestDraw();}};
    const lost=(e:Event)=>{e.preventDefault();latest.current.onError();};
    const start=()=>{
      if(travel||dead)return;if(latest.current.reduced){latest.current.onDone();return;}travel=true;
      timeline=gsap.timeline({onUpdate:()=>{if(process.env.NODE_ENV==='development')node.dataset.motion=String(animation.progress);requestDraw();},onComplete:()=>latest.current.onDone()});
      timeline.to(animation,{progress:1,duration:JOURNEY_SECONDS,ease:'sine.inOut'});
      if(process.env.NODE_ENV==='development'){
        const review=new URLSearchParams(location.search).get('reviewTime');
        if(review!==null&&Number.isFinite(Number(review))){timeline.pause(Math.min(JOURNEY_SECONDS-.01,Math.max(0,Number(review))));requestDraw();}
      }
    };enter.current=start;
    async function initialize(){try{
      if(process.env.NODE_ENV==='development'&&new URLSearchParams(location.search).has('reviewFailure'))throw new Error('Review WebGL fallback');
      renderer=new T.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
      renderer.info.autoReset=false;renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.5));renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=.82;
      renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFShadowMap;
      renderer.domElement.setAttribute('aria-hidden','true');node!.appendChild(renderer.domElement);release=await buildArchitecture(scene,renderer);
      if(dead){release();renderer.dispose();renderer.domElement.remove();return;}
      const target=new T.WebGLRenderTarget(1,1,{type:T.HalfFloatType,samples:4});
      composer=new EffectComposer(renderer,target);
      composer.addPass(new RenderPass(scene,camera));
      ao=new SSAOPass(scene,camera,1,1,16);ao.kernelRadius=.65;ao.minDistance=.002;ao.maxDistance=.12;composer.addPass(ao);
      composer.addPass(new OutputPass());
      resize=new ResizeObserver(()=>{const w=node.clientWidth,h=node.clientHeight;if(!w||!h)return;mobile=w/h<.9;if(!travel)journey=createJourney(mobile);camera.aspect=w/h;camera.fov=mobile?65:56;camera.updateProjectionMatrix();renderer!.setSize(w,h);composer!.setSize(w,h);requestDraw();});resize.observe(node);
      node.addEventListener('pointermove',move);node.addEventListener('pointerleave',leave);document.addEventListener('visibilitychange',visibility);renderer.domElement.addEventListener('webglcontextlost',lost);
      camera.aspect=node.clientWidth/node.clientHeight;mobile=camera.aspect<.9;journey=createJourney(mobile);camera.fov=mobile?65:56;camera.updateProjectionMatrix();renderer.setSize(node.clientWidth,node.clientHeight);composer.setSize(node.clientWidth,node.clientHeight);draw();latest.current.onReady();if(latest.current.entering)start();
    }catch(error){if(!dead){console.error('Registan entrance initialization failed',error);latest.current.onError();}}}
    void initialize();
    return ()=>{dead=true;enter.current=null;timeline?.kill();cancelAnimationFrame(frame);resize?.disconnect();node.removeEventListener('pointermove',move);node.removeEventListener('pointerleave',leave);document.removeEventListener('visibilitychange',visibility);renderer?.domElement.removeEventListener('webglcontextlost',lost);release?.();composer?.passes.forEach(pass=>pass.dispose());composer?.dispose();renderer?.dispose();renderer?.domElement.remove();};
  },[]);
  useEffect(()=>{if(props.entering)enter.current?.();},[props.entering]);
  useEffect(()=>{if(props.reduced&&props.entering)props.onDone();},[props.reduced,props.entering,props.onDone]);
  return <div className="registan-scene" ref={host} role="img" aria-label="Three-dimensional blue and gold portal inspired by Registan, with nested arches and a honeycomb vault"/>;
}
