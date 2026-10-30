// Test-only DevTools hook: inspect the deployed renderer without changing app code.
module.exports = function installProbe() {
  const probe = window.__ariqRenderProbe = { roots:[], state:null, controls:null, frames:[], active:false };
  const inspect = root => {
    const stack=[root.current];let visited=0;
    while(stack.length && visited++<15000){
      const fiber=stack.pop();if(!fiber)continue;
      const store=fiber.memoizedProps?.value;
      if(store?.getState){const state=store.getState();if(state?.gl?.isWebGLRenderer&&state?.camera&&state?.scene)probe.state=state;}
      let hook=fiber.memoizedState,seen=0;
      while(hook&&seen++<80){const ref=hook.memoizedState?.current;if(ref?.target?.isVector3&&ref?.object?.isCamera&&typeof ref.update==='function')probe.controls=ref;hook=hook.next;}
      if(fiber.child)stack.push(fiber.child);if(fiber.sibling)stack.push(fiber.sibling);
    }
  };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__={supportsFiber:true,renderers:new Map(),
    inject(renderer){const id=this.renderers.size+1;this.renderers.set(id,renderer);return id;},
    onCommitFiberRoot(id,root){if(!probe.roots.includes(root))probe.roots.push(root);inspect(root);},
    onCommitFiberUnmount(){},onPostCommitFiberRoot(){},
  };
  probe.discover=()=>{probe.roots.forEach(inspect);return !!(probe.state&&probe.controls);};
  probe.attach=()=>{
    const {gl:renderer}=probe.state,gl=renderer.getContext();
    const ext=gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const original=renderer.render,queries=[];
    renderer.info.autoReset=false;
    renderer.render=function(...args){
      renderer.info.reset();let query;
      if(probe.active&&ext){query=gl.createQuery();gl.beginQuery(ext.TIME_ELAPSED_EXT,query);}
      const start=performance.now();const result=original.apply(this,args);const end=performance.now();
      if(query){gl.endQuery(ext.TIME_ELAPSED_EXT);gl.flush();queries.push(query);}
      if(probe.active)probe.frames.push({at:start,cpuMs:end-start,calls:renderer.info.render.calls,triangles:renderer.info.render.triangles});
      for(let i=queries.length-1;i>=0;i--){if(!gl.getQueryParameter(queries[i],gl.QUERY_RESULT_AVAILABLE))continue;const disjoint=gl.getParameter(ext.GPU_DISJOINT_EXT);if(!disjoint)probe.gpu.push(gl.getQueryParameter(queries[i],gl.QUERY_RESULT)/1e6);gl.deleteQuery(queries[i]);queries.splice(i,1);}
      return result;
    };
    const debug=gl.getExtension('WEBGL_debug_renderer_info');
    probe.gpu=[];
    probe.device={renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),vendor:debug?gl.getParameter(debug.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR),gpuTimer:!!ext,viewport:[gl.drawingBufferWidth,gl.drawingBufferHeight],dpr:renderer.getPixelRatio()};
    probe.resources=()=>{
      const geometry=new Set(),textures=new Set();let geometryBytes=0,shadowBytes=0;
      probe.state.scene.traverse(o=>{if(o.geometry&&!geometry.has(o.geometry)){geometry.add(o.geometry);for(const a of Object.values(o.geometry.attributes))geometryBytes+=a.array.byteLength;if(o.geometry.index)geometryBytes+=o.geometry.index.array.byteLength;}
        if(o.shadow)for(const target of [o.shadow.map,o.shadow.mapPass])if(target&&!textures.has(target.texture)){textures.add(target.texture);const t=target.texture;const channels=[1028,1029].includes(t.format)?1:[1030,1031].includes(t.format)?2:[1022,1032].includes(t.format)?3:4;const bytes=t.type===1015?4:t.type===1016?2:1;shadowBytes+=target.width*target.height*(channels*bytes+(target.depthBuffer?4:0));}});
      return {geometryBytes,estimatedShadowAttachmentBytes:shadowBytes,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,programs:renderer.info.programs.length};
    };
    probe.motion=async({duration=12000,variant='baseline',pointer=false,steps=180}={})=>{
      const {camera,scene,invalidate}=probe.state,c=probe.controls;
      c.enabled=false;c.enableDamping=false;c.update();
      const home=camera.position.clone(),target=c.target.clone(),offset=home.clone().sub(target);
      const radius=offset.length(),polar=Math.acos(offset.y/radius),azimuth=Math.atan2(offset.x,offset.z);
      const originalShadow=renderer.shadowMap.autoUpdate;
      if(variant==='cached-shadow')renderer.shadowMap.autoUpdate=false;
      if(variant==='no-shadow'){renderer.shadowMap.enabled=false;scene.traverse(o=>{if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material])m.needsUpdate=true;});}
      probe.frames=[];probe.gpu=[];probe.active=true;
      const began=performance.now();let step=0;const pointerTimes=[];
      await new Promise(resolve=>{
        function move(now){const t=pointer?Math.min(1,step++/steps):Math.min(1,(now-began)/duration),a=azimuth+.48*Math.sin(t*Math.PI*2),p=polar+.10*Math.sin(t*Math.PI*4),r=radius*(1-.12*(1-Math.cos(t*Math.PI*2))/2);
          c.target.set(target.x+.65*Math.sin(t*Math.PI*2),target.y,target.z+.35*Math.sin(t*Math.PI*4));
          camera.position.set(c.target.x+r*Math.sin(p)*Math.sin(a),c.target.y+r*Math.cos(p),c.target.z+r*Math.sin(p)*Math.cos(a));camera.lookAt(c.target);invalidate();
          if(pointer){const rect=renderer.domElement.getBoundingClientRect(),start=performance.now();renderer.domElement.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:1,pointerType:'mouse',isPrimary:true,buttons:1,clientX:rect.left+rect.width*(.5+.10*Math.sin(t*Math.PI*2)),clientY:rect.top+rect.height*(.53+.07*Math.cos(t*Math.PI*2))}));pointerTimes.push(performance.now()-start);}
          if(t<1)requestAnimationFrame(move);else resolve();}
        requestAnimationFrame(move);
      });
      probe.active=false;renderer.shadowMap.autoUpdate=originalShadow;
      camera.position.copy(home);c.target.copy(target);c.update();invalidate();
      return {frames:probe.frames,gpuMs:probe.gpu,pointerMs:pointerTimes,resources:probe.resources(),device:probe.device,durationMs:performance.now()-began};
    };
    return probe.device;
  };
};
