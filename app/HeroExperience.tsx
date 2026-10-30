'use client';

import {useEffect, useRef, useState} from 'react';
import * as THREE from 'three';

type Props = {onSelect?: (point: [number, number]) => void};
type Terrain = {bounds: [number, number, number, number]; size: number; heights: number[]; min: number; max: number; retrievedAt: string; sourceUrl: string; attribution: string};
type Water = {ways: {id: number; name: string; kind: 'river' | 'canal'; coordinates: [number, number][]}[]; attribution: string; retrievedAt: string};
type Commands = {rotate: (amount: number) => void; reset: () => void; water: (show: boolean) => void; select: () => void};
const SOURCE = 'https://registry.opendata.aws/terrain-tiles/';
const HOME = {azimuth: -.31, elevation: .79};

function Arrow({down = false}: {down?: boolean}) {
 return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" style={down ? {transform: 'rotate(90deg)'} : undefined}><path d="M4 12h15m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.5"/></svg>;
}

function validate(value: unknown): Terrain {
 const t = value as Terrain;
 if (!t || t.size !== 161 || !Array.isArray(t.bounds) || t.bounds.length !== 4 || !t.bounds.every(Number.isFinite) || t.bounds[2] <= t.bounds[0] || t.bounds[3] <= t.bounds[1] || !Array.isArray(t.heights) || t.heights.length !== t.size * t.size || !t.heights.every(Number.isFinite) || !Number.isFinite(t.min) || !Number.isFinite(t.max) || t.max <= t.min || t.heights.some(h => h < t.min - 1 || h > t.max + 1)) throw new Error('The elevation file could not be read.');
 return t;
}

// Liang–Barsky clipping retains segments crossing the bounds, including those
// whose original endpoints both lie outside the terrain.
function clip(a: [number, number], b: [number, number], bounds: Terrain['bounds']): [[number, number], [number, number]] | null {
 const dx = b[0] - a[0], dy = b[1] - a[1];
 const p = [-dx, dx, -dy, dy], q = [a[0] - bounds[0], bounds[2] - a[0], a[1] - bounds[1], bounds[3] - a[1]];
 let lo = 0, hi = 1;
 for (let i = 0; i < 4; i++) {
  if (Math.abs(p[i]) < 1e-12) {if (q[i] < 0) return null;}
  else {const u = q[i] / p[i]; if (p[i] < 0) lo = Math.max(lo, u); else hi = Math.min(hi, u); if (lo > hi) return null;}
 }
 return [[a[0] + lo * dx, a[1] + lo * dy], [a[0] + hi * dx, a[1] + hi * dy]];
}

export default function HeroExperience({onSelect}: Props) {
 const section = useRef<HTMLElement>(null), host = useRef<HTMLDivElement>(null);
 const commands = useRef<Commands | null>(null), selectRef = useRef(onSelect);
 const [attempt, setAttempt] = useState(0), [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
 const [message, setMessage] = useState('Preparing the elevation model'), [terrain, setTerrain] = useState<Terrain | null>(null);
 const [waterData, setWaterData] = useState<Water | null>(null), [waterOn, setWaterOn] = useState(true);
 const [selected, setSelected] = useState<[number, number] | null>(null);
 useEffect(() => {selectRef.current = onSelect;}, [onSelect]);

 useEffect(() => {
  const mountNode = host.current, regionNode = section.current;
  if (!mountNode || !regionNode) return;
  const mount: HTMLDivElement = mountNode, region: HTMLElement = regionNode;
  let disposed = false, visible = true, frame = 0, failed = false;
  let renderer: THREE.WebGLRenderer | undefined, scene: THREE.Scene | undefined;
  let camera: THREE.PerspectiveCamera | undefined, surface: THREE.Mesh | undefined;
  let resize: ResizeObserver | undefined, observer: IntersectionObserver | undefined;
  let marker: THREE.Mesh | undefined, waterGroup: THREE.Group | undefined;
  const controller = new AbortController(), media = window.matchMedia('(prefers-reduced-motion: reduce)');
  const resources = new Set<{dispose: () => void}>();
  const own = <T extends {dispose: () => void},>(resource: T): T => {resources.add(resource); return resource;};
  const current = {...HOME}, target = {...HOME};
  let reduced = media.matches, interaction = false, lastTime = 0;
  let pointer: {id: number; x: number; y: number; startX: number; startY: number; moved: boolean; touch: boolean} | null = null;
  let fit = 15, modelDepth = 12, terrainData: Terrain | undefined;
  const raycaster = new THREE.Raycaster();
  setStatus('loading'); setMessage('Preparing the elevation model'); setTerrain(null); setWaterData(null); setWaterOn(true); setSelected(null);

  const fail = (text: string) => {
   if (disposed || failed) return;
   failed = true; cancelAnimationFrame(frame); frame = 0; commands.current = null;
   setMessage(text); setStatus('error');
  };
  const positionCamera = () => {
   if (!camera) return;
   const r = fit, horizontal = Math.cos(current.elevation) * r;
   camera.position.set(Math.sin(current.azimuth) * horizontal, Math.sin(current.elevation) * r + .1, Math.cos(current.azimuth) * horizontal);
   camera.lookAt(0, .08, 0); camera.updateMatrixWorld();
  };
  const tick = (time: number) => {
   frame = 0;
   if (disposed || !visible || failed || !renderer || !scene || !camera || document.hidden) return;
   const delta = lastTime ? Math.min(64, time - lastTime) : 16; lastTime = time;
   const blend = reduced ? 1 : 1 - Math.exp(-delta / 130);
   current.azimuth += (target.azimuth - current.azimuth) * blend;
   current.elevation += (target.elevation - current.elevation) * blend;
   positionCamera();
   try {renderer.render(scene, camera);} catch {fail('The 3D view could not be displayed.'); return;}
   if (Math.abs(target.azimuth - current.azimuth) + Math.abs(target.elevation - current.elevation) > .0001) frame = requestAnimationFrame(tick);
  };
  const draw = () => {if (!disposed && visible && !failed && !document.hidden && !frame) frame = requestAnimationFrame(tick);};
  const motionChange = () => {reduced = media.matches; if (reduced && !interaction) Object.assign(target, HOME); draw();};
  const scroll = () => {
   if (interaction || reduced || !visible) return;
   const box = region.getBoundingClientRect();
   const progress = THREE.MathUtils.clamp(-box.top / Math.max(1, box.height * .9), 0, 1);
   target.elevation = HOME.elevation + progress * .51;
   target.azimuth = HOME.azimuth + progress * .16;
   draw();
  };
  const visibility = () => {lastTime = 0; if (document.hidden) {cancelAnimationFrame(frame); frame = 0;} else draw();};
  const contextLost = (event: Event) => {event.preventDefault(); fail('The 3D connection was interrupted.');};
  const pick = (x: number, y: number) => {
   if (!renderer || !camera || !surface || !terrainData || failed) return;
   positionCamera(); surface.updateMatrixWorld(true);
   const rect = renderer.domElement.getBoundingClientRect();
   raycaster.setFromCamera(new THREE.Vector2((x - rect.left) / rect.width * 2 - 1, 1 - (y - rect.top) / rect.height * 2), camera);
   const hit = raycaster.intersectObject(surface, false)[0];
   if (!hit) return;
   const p = surface.worldToLocal(hit.point.clone()), bounds = terrainData.bounds;
   const point: [number, number] = [bounds[0] + (p.x + 6) / 12 * (bounds[2] - bounds[0]), bounds[3] - (p.z / modelDepth + .5) * (bounds[3] - bounds[1])];
   if (marker) {marker.position.copy(hit.point); marker.position.y += .045; marker.visible = true;}
   setSelected(point); selectRef.current?.(point); draw();
  };
  const down = (e: PointerEvent) => {
   if (pointer || (e.pointerType === 'mouse' && e.button !== 0)) return;
   pointer = {id: e.pointerId, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, moved: false, touch: e.pointerType !== 'mouse'};
   interaction = true;
   renderer?.domElement.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent) => {
   if (!pointer || pointer.id !== e.pointerId) return;
   const dx = e.clientX - pointer.x, dy = e.clientY - pointer.y;
   if (Math.hypot(e.clientX - pointer.startX, e.clientY - pointer.startY) > 7) pointer.moved = true;
   if (pointer.moved) {
    target.azimuth -= dx * .006;
    if (!pointer.touch) target.elevation = THREE.MathUtils.clamp(target.elevation + dy * .004, .38, 1.39);
    draw();
   }
   pointer.x = e.clientX; pointer.y = e.clientY;
  };
  const up = (e: PointerEvent) => {
   if (!pointer || pointer.id !== e.pointerId) return;
   const clicked = !pointer.moved && Math.hypot(e.clientX - pointer.startX, e.clientY - pointer.startY) <= 7;
   pointer = null;
   if (renderer?.domElement.hasPointerCapture(e.pointerId)) renderer.domElement.releasePointerCapture(e.pointerId);
   if (clicked) pick(e.clientX, e.clientY);
  };
  const cancel = () => {pointer = null;};

  async function start() {
   try {
    const response = await fetch('/data/samarkand-terrain.json', {signal: controller.signal});
    if (!response.ok) throw new Error('The elevation model is temporarily unavailable.');
    const t = validate(await response.json());
    if (disposed) return;
    terrainData = t; setTerrain(t);
    renderer = new THREE.WebGLRenderer({antialias: true, alpha: true, powerPreference: 'low-power'});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setClearColor(0xf8f9f4, 0);
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.16;
    const canvas = renderer.domElement;
    canvas.setAttribute('aria-label', 'Real Samarkand elevation model. Drag to rotate or click terrain to select a forecast location. Equivalent controls follow the model.');
    canvas.setAttribute('role', 'img');
    canvas.addEventListener('webglcontextlost', contextLost);
    canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', cancel); canvas.addEventListener('lostpointercapture', cancel);
    mount.appendChild(canvas);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(34, 1, .1, 100);
    const meanLat = (t.bounds[1] + t.bounds[3]) / 2 * Math.PI / 180;
    const eastWestMeters = (t.bounds[2] - t.bounds[0]) * Math.PI / 180 * 6371008.8 * Math.cos(meanLat);
    const northSouthMeters = (t.bounds[3] - t.bounds[1]) * Math.PI / 180 * 6371008.8;
    modelDepth = 12 * northSouthMeters / eastWestMeters;
    const elevationScale = 12 / eastWestMeters * 3, base = -.36;
    const n = t.size, vertices = new Float32Array(n * n * 3), colors = new Float32Array(n * n * 3);
    const low = new THREE.Color('#e4e8dd'), high = new THREE.Color('#faf8ed'), color = new THREE.Color();
    for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) {
     const index = row * n + col, h = t.heights[index];
     vertices[index * 3] = col / (n - 1) * 12 - 6;
     vertices[index * 3 + 1] = (h - t.min) * elevationScale;
     vertices[index * 3 + 2] = (row / (n - 1) - .5) * modelDepth;
     color.copy(low).lerp(high, (h - t.min) / (t.max - t.min)); color.toArray(colors, index * 3);
    }
    const indices: number[] = [];
    for (let row = 0; row < n - 1; row++) for (let col = 0; col < n - 1; col++) {
     const a = row * n + col, b = a + 1, c = a + n, d = c + 1;
     indices.push(a, c, b, b, c, d);
    }
    const geometry = own(new THREE.BufferGeometry());
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3)); geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3)); geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
    surface = new THREE.Mesh(geometry, own(new THREE.MeshStandardMaterial({vertexColors: true, roughness: .82, metalness: 0})));
    surface.castShadow = true; surface.receiveShadow = true; scene.add(surface);
    // A separate closed skirt keeps the sampled upper surface smooth while
    // preserving crisp vertical cut edges along all four boundaries.
    const edge: number[] = [];
    for (let c = 0; c < n; c++) edge.push(c);
    for (let r = 1; r < n; r++) edge.push(r * n + n - 1);
    for (let c = n - 2; c >= 0; c--) edge.push((n - 1) * n + c);
    for (let r = n - 2; r > 0; r--) edge.push(r * n);
    const sides: number[] = [];
    const push = (index: number, bottom: boolean) => sides.push(vertices[index * 3], bottom ? base : vertices[index * 3 + 1], vertices[index * 3 + 2]);
    for (let i = 0; i < edge.length; i++) {
     const a = edge[i], b = edge[(i + 1) % edge.length];
     push(a, false); push(b, false); push(a, true); push(b, false); push(b, true); push(a, true);
    }
    const sideGeometry = own(new THREE.BufferGeometry()); sideGeometry.setAttribute('position', new THREE.Float32BufferAttribute(sides, 3)); sideGeometry.computeVertexNormals();
    const sideMaterial = own(new THREE.MeshStandardMaterial({color: '#d9ddcf', roughness: .8, side: THREE.DoubleSide}));
    const skirt = new THREE.Mesh(sideGeometry, sideMaterial); skirt.castShadow = true; skirt.receiveShadow = true; scene.add(skirt);
    const bottom = new THREE.Mesh(own(new THREE.PlaneGeometry(12, modelDepth)), sideMaterial); bottom.rotation.x = Math.PI / 2; bottom.position.y = base; scene.add(bottom);
    const floor = new THREE.Mesh(own(new THREE.PlaneGeometry(200, 200)), own(new THREE.ShadowMaterial({color: '#496365', opacity: .16})));
    floor.rotation.x = -Math.PI / 2; floor.position.y = base - .015; floor.receiveShadow = true; scene.add(floor);
    scene.add(new THREE.HemisphereLight('#fffdf2', '#b7c9cb', 2.65));
    const sun = new THREE.DirectionalLight('#fff7e7', 3.8); sun.position.set(-9, 15, -7); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = -12; sun.shadow.camera.right = 12; sun.shadow.camera.top = 13; sun.shadow.camera.bottom = -13;
    sun.shadow.camera.near = .5; sun.shadow.camera.far = 45; sun.shadow.normalBias = .018; sun.shadow.bias = -.0001; sun.shadow.radius = 3; scene.add(sun); resources.add({dispose: () => sun.shadow.dispose()});
    const fill = new THREE.DirectionalLight('#c2e5e8', .8); fill.position.set(9, 6, 8); scene.add(fill);
    marker = new THREE.Mesh(own(new THREE.SphereGeometry(.065, 18, 12)), own(new THREE.MeshStandardMaterial({color: '#007f83', roughness: .4})));
    marker.visible = false; scene.add(marker);
    waterGroup = new THREE.Group(); scene.add(waterGroup);
    const measure = () => {
     if (!renderer || !camera || disposed) return;
     const w = mount.clientWidth, h = mount.clientHeight;
     if (!w || !h) return;
     camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
     // Fit a bounding sphere of the real geographic rectangle. Allow breathing
     // room for its solid edges and shadows at every supported rotation.
     const halfAngle = Math.min(camera.fov * Math.PI / 360, Math.atan(Math.tan(camera.fov * Math.PI / 360) * camera.aspect));
     fit = Math.hypot(6, modelDepth / 2, (t.max - t.min) * elevationScale / 2) / Math.sin(halfAngle) * 1.04;
     draw();
    };
    resize = new ResizeObserver(measure); resize.observe(mount); measure();
    observer = new IntersectionObserver(entries => {
     visible = entries[0].isIntersecting; lastTime = 0;
     if (visible) {scroll(); draw();} else {cancelAnimationFrame(frame); frame = 0;}
    }, {threshold: 0}); observer.observe(region);
    commands.current = {
     rotate: amount => {interaction = true; target.azimuth += amount; draw();},
     reset: () => {interaction = true; Object.assign(target, HOME); draw();},
     water: show => {if (waterGroup) {waterGroup.visible = show; draw();}},
     select: () => {if (renderer) {const r = renderer.domElement.getBoundingClientRect(); pick(r.left + r.width / 2, r.top + r.height / 2);}}
    };
    media.addEventListener('change', motionChange); window.addEventListener('scroll', scroll, {passive: true}); document.addEventListener('visibilitychange', visibility);
    renderer.compile(scene, camera); renderer.render(scene, camera); setStatus('ready'); draw();

    // Water is optional. Missing or invalid data never creates an invented route.
    try {
     const response = await fetch('/data/samarkand-waterways.json', {signal: controller.signal});
     if (!response.ok) return;
     const data = await response.json() as Water;
     if (disposed || failed || !Array.isArray(data.ways) || !waterGroup) return;
     const sample = (lon: number, lat: number) => {
      const x = THREE.MathUtils.clamp((lon - t.bounds[0]) / (t.bounds[2] - t.bounds[0]) * (n - 1), 0, n - 1);
      const z = THREE.MathUtils.clamp((t.bounds[3] - lat) / (t.bounds[3] - t.bounds[1]) * (n - 1), 0, n - 1);
      const x0 = Math.floor(x), z0 = Math.floor(z), x1 = Math.min(n - 1, x0 + 1), z1 = Math.min(n - 1, z0 + 1);
      const top = THREE.MathUtils.lerp(t.heights[z0 * n + x0], t.heights[z0 * n + x1], x - x0);
      const lower = THREE.MathUtils.lerp(t.heights[z1 * n + x0], t.heights[z1 * n + x1], x - x0);
      return new THREE.Vector3(x / (n - 1) * 12 - 6, (THREE.MathUtils.lerp(top, lower, z - z0) - t.min) * elevationScale + .018, (z / (n - 1) - .5) * modelDepth);
     };
     const rivers: number[] = [], canals: number[] = [];
     for (const way of data.ways) {
      if (!way || !['river', 'canal'].includes(way.kind) || !Array.isArray(way.coordinates)) continue;
      for (let i = 1; i < way.coordinates.length; i++) {
       const a = way.coordinates[i - 1], b = way.coordinates[i];
       if (!Array.isArray(a) || !Array.isArray(b) || a.length !== 2 || b.length !== 2 || ![...a, ...b].every(Number.isFinite)) continue;
       const segment = clip(a, b, t.bounds); if (!segment) continue;
       const [s, e] = segment, first = sample(...s), last = sample(...e);
       const steps = Math.max(1, Math.ceil(Math.hypot(last.x - first.x, last.z - first.z) / .035));
       const destination = way.kind === 'river' ? rivers : canals;
       let previous = first;
       for (let step = 1; step <= steps; step++) {
        const f = step / steps, next = sample(THREE.MathUtils.lerp(s[0], e[0], f), THREE.MathUtils.lerp(s[1], e[1], f));
        destination.push(previous.x, previous.y, previous.z, next.x, next.y, next.z); previous = next;
       }
      }
     }
     for (const [positions, color] of [[rivers, '#007f83'], [canals, '#173f78']] as const) {
      if (!positions.length) continue;
      const g = own(new THREE.BufferGeometry()); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const line = new THREE.LineSegments(g, own(new THREE.LineBasicMaterial({color, transparent: true, opacity: .9})));
      waterGroup.add(line);
     }
     if (waterGroup.children.length) {setWaterData(data); draw();}
    } catch { /* Optional source; the elevation remains usable. */ }
   } catch (error) {
    if (!disposed && !controller.signal.aborted) fail(error instanceof Error ? error.message : 'The 3D view is unavailable.');
   }
  }
  void start();
  return () => {
   disposed = true; controller.abort(); commands.current = null; cancelAnimationFrame(frame);
   resize?.disconnect(); observer?.disconnect();
   media.removeEventListener('change', motionChange); window.removeEventListener('scroll', scroll); document.removeEventListener('visibilitychange', visibility);
   if (renderer) {
    const canvas = renderer.domElement;
    canvas.removeEventListener('webglcontextlost', contextLost); canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', cancel); canvas.removeEventListener('lostpointercapture', cancel);
    for (const resource of resources) resource.dispose();
    scene?.clear(); renderer.renderLists.dispose(); renderer.dispose(); renderer.forceContextLoss(); canvas.remove();
   } else for (const resource of resources) resource.dispose();
  };
 }, [attempt]);

 return <section className="ariq-hero" ref={section} aria-labelledby="terrain-heading">
  <header className="terrain-header"><a href="#top" className="terrain-brand" aria-label="ARIQ home">ARIQ<span className="brand-cut" aria-hidden="true"/></a><span className="terrain-country">Uzbekistan <span>/ Samarkand</span></span><a className="terrain-explore" href="#workspace">Explore <Arrow/></a></header>
  <div className="terrain-intro"><div className="terrain-eyebrow"><span/>Zarafshan valley</div><h1 id="terrain-heading">The land.<br/><em>The water.</em></h1><p>Water intelligence,<br/>starting in Samarkand.</p></div>
  <div className="terrain-stage" ref={host} aria-busy={status === 'loading'}/>
  {status !== 'ready' && <div className="terrain-status" role={status === 'error' ? 'alert' : 'status'}><span className="status-rule"/><p>{status === 'loading' ? 'Bringing the land into view.' : 'The terrain is taking a pause.'}</p><span>{message}</span>{status === 'error' && <div><button onClick={() => setAttempt(v => v + 1)}>Retry 3D view</button><a href="#workspace">Open the atlas <Arrow/></a></div>}</div>}
  <div className="terrain-north" aria-label="Model north is the back edge; camera rotates around the model"><span>N</span><svg viewBox="0 0 24 40" aria-hidden="true"><path d="M12 1 4 24l8-5 8 5Z" fill="none" stroke="currentColor" strokeWidth="1"/><path d="M12 1v38" stroke="currentColor" strokeWidth="1"/></svg><span>Model north</span></div>
  <div className="terrain-location"><span>Samarkand</span><span>39.40–39.82° N<br/>66.75–67.20° E</span></div>
  <div className="terrain-bottom">
   <div className="terrain-caption"><span className="terrain-index">01 /</span><div><strong>Land, in relief</strong><p>Real elevation. A different perspective.</p></div></div>
   <div className="terrain-controls" role="group" aria-label="Terrain controls"><button disabled={status !== 'ready'} onClick={() => commands.current?.rotate(-Math.PI / 6)} aria-label="Rotate terrain left"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m10 5-6 6 6 6M4 11h9a6 6 0 0 1 6 6" stroke="currentColor" strokeWidth="1.5"/></svg></button><button disabled={status !== 'ready'} onClick={() => commands.current?.rotate(Math.PI / 6)} aria-label="Rotate terrain right"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m14 5 6 6-6 6m6-6h-9a6 6 0 0 0-6 6" stroke="currentColor" strokeWidth="1.5"/></svg></button><button disabled={status !== 'ready'} onClick={() => commands.current?.reset()}>Reset</button><span className="control-divider"/><button className="water-control" aria-pressed={!!waterData && waterOn} disabled={!waterData || status !== 'ready'} title={waterData ? 'Show mapped waterways; flow is not measured' : 'Mapped waterway data is not available for this view'} onClick={() => {const next = !waterOn; setWaterOn(next); commands.current?.water(next);}}><span/>Waterways</button></div>
   <a className="terrain-enter" href="#workspace">Enter the atlas <Arrow down/></a>
  </div>
  <div className="terrain-footline"><span className="terrain-gesture">Drag to turn · Select land for a forecast</span><button className="terrain-center" disabled={status !== 'ready'} onClick={() => commands.current?.select()}>Select view center</button><details className="terrain-details"><summary>Elevation & sources <span>+</span></summary><div><strong>Samarkand elevation model</strong><p>161 × 161 sampled elevations. {terrain ? `${terrain.min.toLocaleString('en-GB')}–${terrain.max.toLocaleString('en-GB')} m above sea level.` : 'Elevation source loading.'} Vertical relief is exaggerated 3×; horizontal proportions follow geographic distance.</p><p>Elevation estimates describe the land, not water availability. {waterData ? 'Waterways are mapped features, not live flow measurements.' : 'Waterway data is not loaded; no water routes are inferred.'}</p><a href={SOURCE} target="_blank" rel="noreferrer">Terrain Tiles · source ↗</a>{terrain && <p>{terrain.attribution}<br/>{Number.isFinite(Date.parse(terrain.retrievedAt)) && `Retrieved ${new Date(terrain.retrievedAt).toLocaleDateString('en-GB', {timeZone: 'UTC'})}`}</p>}{waterData && <p><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors ↗</a>{Number.isFinite(Date.parse(waterData.retrievedAt)) && <><br/>Retrieved {new Date(waterData.retrievedAt).toLocaleDateString('en-GB', {timeZone: 'UTC'})}</>}</p>}</div></details></div>
  <span className="terrain-selection" role="status">{selected ? `Forecast location selected: ${selected[1].toFixed(4)}° N, ${selected[0].toFixed(4)}° E. Open the atlas to view it.` : ''}</span>
 </section>;
}

