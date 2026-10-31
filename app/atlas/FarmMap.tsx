'use client';
import { useEffect, useRef, useState } from 'react';
import type { Map as MapInstance } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { rectangleRing, ringClosed, type LonLat } from './geo';
import {text} from './copy';
import type {Language} from '../../lib/i18n-labels';
import {loadMapWater} from './mapWater';

export type DrawMode = 'idle' | 'rect' | 'polygon' | 'edit';

function farmGeoJson(farm: LonLat[] | null, draft: LonLat[], drafting: boolean, rectangle = false): any {
  const features: any[] = [];
  if (farm && farm.length >= 3) {
    features.push({ type: 'Feature', properties: { role: 'farm' }, geometry: { type: 'Polygon', coordinates: [ringClosed(farm)] } });
    farm.forEach((p, i) => features.push({ type: 'Feature', properties: { role: 'vertex', index: i }, geometry: { type: 'Point', coordinates: p } }));
  }
  if (drafting && draft.length > 0) {
    if (draft.length >= 2) features.push({ type: 'Feature', properties: { role: 'draft-line' }, geometry: { type: 'LineString', coordinates: rectangle && draft.length === 4 ? ringClosed(draft) : draft } });
    draft.forEach((p, i) => features.push({ type: 'Feature', properties: { role: 'vertex', index: i }, geometry: { type: 'Point', coordinates: p } }));
  }
  return { type: 'FeatureCollection', features };
}

export default function FarmMap({ center, farm, onFarmChange, onIdleClick,language,readOnly=false }: {
  center: LonLat;
  farm: LonLat[] | null;
  onFarmChange: (ring: LonLat[] | null, kind: 'rect' | 'polygon') => void;
  onIdleClick: (p: LonLat) => void;
  language:Language;
  readOnly?:boolean;
}) {
  const t=(id:string)=>text(id,language);
  const changeRef=useRef(onFarmChange);changeRef.current=onFarmChange;
  const idleRef=useRef(onIdleClick);idleRef.current=onIdleClick;
  const [mapError,setMapError]=useState(false);
  const [waterError,setWaterError]=useState(false);
  const commit=(ring:LonLat[]|null,kind:'rect'|'polygon')=>changeRef.current(ring,kind);
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapInstance | null>(null);
  const [mode, setMode] = useState<DrawMode>('idle');
  const [draft, setDraft] = useState<LonLat[]>([]);
  const [ready, setReady] = useState(false);
  const modeRef = useRef(mode); modeRef.current = mode;
  const draftRef = useRef(draft); draftRef.current = draft;
  const farmRef = useRef(farm); farmRef.current = farm;
  const farmKindRef = useRef<'rect' | 'polygon'>('polygon');
  const historyRef = useRef<(LonLat[] | null)[]>([]);
  const rectStartRef = useRef<LonLat | null>(null);
  const dragVertexRef = useRef<number | null>(null);
  const dragStartFarmRef = useRef<LonLat[] | null>(null);

  const pushHistory = () => { historyRef.current.push(farmRef.current ? farmRef.current.map((p) => [...p] as LonLat) : null); if (historyRef.current.length > 30) historyRef.current.shift(); };

  useEffect(() => {
    let disposed = false; let map: MapInstance | undefined; let moveTimer: ReturnType<typeof setTimeout> | undefined;
    let waterRequest: AbortController | undefined;
    let waterRevision = 0;
    import('maplibre-gl').then(({ Map, NavigationControl, ScaleControl, setWorkerUrl }) => {
      if (disposed || !host.current) return;
      setWorkerUrl(new URL('maplibre-gl/dist/maplibre-gl-worker.mjs', import.meta.url).toString());
      map = new Map({
        container: host.current, center, zoom: 13, pitch: 0, bearing: 0, maxZoom: 18, minZoom: 5,
        attributionControl: { compact: true },
        style: {
          version: 8,
          sources: {
            imagery: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 18, attribution: 'Imagery: Esri, Maxar, Earthstar Geographics' },
          },
          layers: [
            { id: 'imagery', type: 'raster', source: 'imagery', paint: { 'raster-saturation': -0.12, 'raster-brightness-max': 0.92 } },
          ],
        } as never,
      });
      mapRef.current = map;
      if(farmRef.current?.length){const ring=farmRef.current;map.fitBounds([[Math.min(...ring.map(p=>p[0])),Math.min(...ring.map(p=>p[1]))],[Math.max(...ring.map(p=>p[0])),Math.max(...ring.map(p=>p[1]))]],{padding:80,maxZoom:17,duration:0});}
      map.on('error',e=>{if((e as unknown as {sourceId?:string}).sourceId==='imagery')setMapError(true);});
      map.on('sourcedata',e=>{if(e.sourceId==='imagery'&&e.sourceDataType==='content')setMapError(false);});
      map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');
      map.addControl(new ScaleControl({unit:'metric',maxWidth:100}),'bottom-left');
      map.on('style.load', () => {
        if (!map) return;
        map.addSource('farm-water', { type: 'geojson', tolerance: 0, data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ id: 'farm-water-lines', type: 'line', source: 'farm-water', filter: ['==', ['geometry-type'], 'LineString'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#7fd4de', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1, 13, 2, 18, 3], 'line-opacity': 0.8 } });
        map.addLayer({ id: 'farm-water-points', type: 'circle', source: 'farm-water', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 4, 'circle-color': '#2f648f', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.2 } });
        map.addSource('farm-draw', { type: 'geojson', data: farmGeoJson(farmRef.current, [], false) });
        map.addLayer({ id: 'farm-fill', type: 'fill', source: 'farm-draw', filter: ['==', ['get', 'role'], 'farm'], paint: { 'fill-color': '#ba985e', 'fill-opacity': 0.28 } });
        map.addLayer({ id: 'farm-line', type: 'line', source: 'farm-draw', filter: ['any', ['==', ['get', 'role'], 'farm'], ['==', ['get', 'role'], 'draft-line']], paint: { 'line-color': '#f3d9a4', 'line-width': 2.5, 'line-dasharray': [1] } });
        map.addLayer({ id: 'farm-vertices', type: 'circle', source: 'farm-draw', filter: ['==', ['get', 'role'], 'vertex'], paint: { 'circle-radius': 6, 'circle-color': '#f1f5f5', 'circle-stroke-color': '#29405b', 'circle-stroke-width': 2 } });
        setReady(true);
        loadWater();
      });
      const loadWater = async () => {
        if (!map) return;
        waterRequest?.abort();
        const controller = waterRequest = new AbortController();
        const revision = ++waterRevision;
        const b = map.getBounds();
        // Fetch beyond the visible edges so small pans do not cut off nearby segments.
        const dx=(b.getEast()-b.getWest())*.25,dy=(b.getNorth()-b.getSouth())*.25;
        const bbox = `${Math.max(-180,b.getWest()-dx)},${Math.max(-90,b.getSouth()-dy)},${Math.min(180,b.getEast()+dx)},${Math.min(90,b.getNorth()+dy)}`;
        try {
          const data=await loadMapWater(bbox,controller.signal);
          if(disposed||controller.signal.aborted||revision!==waterRevision)return;
          (map.getSource('farm-water') as import('maplibre-gl').GeoJSONSource|undefined)?.setData(data);
          setWaterError(false);
        } catch {
          // Preserve the last good overlay on failures; never flash an empty network.
          if(!disposed&&!controller.signal.aborted&&revision===waterRevision)setWaterError(true);
        }
      };
      map.on('movestart',()=>{clearTimeout(moveTimer);waterRequest?.abort();waterRevision++;});
      map.on('moveend', () => { clearTimeout(moveTimer); moveTimer = setTimeout(loadWater, 350); });
      const lonLatOf = (e: any): LonLat => [e.lngLat.lng, e.lngLat.lat];
      const vertexAt = (e: any, ring: LonLat[]): number => {
        if (!map) return -1;
        const pt = map.project(e.lngLat);
        let best = -1; let bestD = 16;
        ring.forEach((p, i) => { const q = map!.project(p as any); const d = Math.hypot(q.x - pt.x, q.y - pt.y); if (d < bestD) { bestD = d; best = i; } });
        return best;
      };
      map.on('mousedown', (e) => {
        if (!map) return;
        const m = modeRef.current;
        if (m === 'rect') {
          if(!rectStartRef.current) rectStartRef.current = lonLatOf(e);
          map.dragPan.disable();
          setDraft([lonLatOf(e), lonLatOf(e)]);
        } else if (m === 'edit' && farmRef.current) {
          const idx = vertexAt(e, farmRef.current);
          if (idx >= 0) { dragVertexRef.current = idx; dragStartFarmRef.current = farmRef.current; map.dragPan.disable(); }
        }
      });
      map.on('mousemove', (e) => {
        if (!map) return;
        const m = modeRef.current;
        if (m === 'rect' && rectStartRef.current) {
          const start=map.project(rectStartRef.current),end=map.project(e.lngLat);
          if(Math.hypot(start.x-end.x,start.y-end.y)<10)return;
          setDraft(rectangleRing(rectStartRef.current, lonLatOf(e)));
        } else if (m === 'edit' && dragVertexRef.current !== null && farmRef.current) {
          const idx = dragVertexRef.current;
          const next = farmRef.current.map((p) => [...p] as LonLat);
          if (farmKindRef.current === 'rect' && next.length === 4) {
            const opposite = next[(idx + 2) % 4];
            commit(rectangleRing(opposite, lonLatOf(e)), 'rect');
          } else {
            next[idx] = lonLatOf(e);
            commit(next, farmKindRef.current);
          }
        }
      });
      map.on('mouseup', (e) => {
        if (!map) return;
        const m = modeRef.current;
        if (m === 'rect' && rectStartRef.current) {
          const start=map.project(rectStartRef.current),end=map.project(e.lngLat);
          if(Math.hypot(start.x-end.x,start.y-end.y)<10)return;
          const ring = rectangleRing(rectStartRef.current, lonLatOf(e));
          pushHistory();
          farmKindRef.current = 'rect';
          commit(ring, 'rect');
          rectStartRef.current = null;
          setDraft([]); setMode('idle');
          map.dragPan.enable();
        } else if (m === 'edit' && dragVertexRef.current !== null) {
          if (dragStartFarmRef.current) { historyRef.current.push(dragStartFarmRef.current); }
          dragVertexRef.current = null; dragStartFarmRef.current = null;
          map.dragPan.enable();
        }
      });
      map.on('click', (e) => {
        const m = modeRef.current;
        if (m === 'polygon' && e.originalEvent.detail < 2) {
          const d = draftRef.current;
          if (d.length >= 3 && map) {
            const first = map.project(d[0]);
            const pointer = map.project(e.lngLat);
            const radius = e.originalEvent instanceof MouseEvent ? 20 : 28;
            if (Math.hypot(first.x-pointer.x, first.y-pointer.y) <= radius) { finishPolygon(); return; }
          }
          setDraft((points) => [...points, lonLatOf(e)]);
        }
        else if (m === 'idle') idleRef.current(lonLatOf(e));
      });
      map.on('touchend',e=>{
        if(!map||modeRef.current!=='rect')return;
        const p=lonLatOf(e);
        if(!rectStartRef.current){rectStartRef.current=p;setDraft([p]);return;}
        const start=map.project(rectStartRef.current),end=map.project(p);
        if(Math.hypot(start.x-end.x,start.y-end.y)<10)return;
        pushHistory();farmKindRef.current='rect';commit(rectangleRing(rectStartRef.current,p),'rect');rectStartRef.current=null;setDraft([]);setMode('idle');
      });
      map.on('touchstart',e=>{if(!map||modeRef.current!=='edit'||!farmRef.current)return;const idx=vertexAt(e,farmRef.current);if(idx>=0){e.preventDefault();dragVertexRef.current=idx;dragStartFarmRef.current=farmRef.current;map.dragPan.disable();}});
      map.on('touchmove',e=>{if(modeRef.current!=='edit'||dragVertexRef.current===null||!farmRef.current)return;e.preventDefault();const next=farmRef.current.map(p=>[...p] as LonLat);next[dragVertexRef.current]=lonLatOf(e);commit(next,'polygon');});
      map.on('touchend',()=>{if(dragVertexRef.current!==null){if(dragStartFarmRef.current)historyRef.current.push(dragStartFarmRef.current);dragVertexRef.current=null;dragStartFarmRef.current=null;}});
      map.on('dblclick', (e) => {
        if (modeRef.current === 'polygon') { e.preventDefault(); finishPolygon(); }
      });
    }).catch(() => setMapError(true));
    const finishPolygon = () => {
      const d = draftRef.current;
      if (d.length >= 3) { pushHistory(); farmKindRef.current = 'polygon'; commit(d, 'polygon'); }
      setDraft([]); setMode('idle');
    };
    return () => { disposed = true; clearTimeout(moveTimer); waterRequest?.abort(); map?.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lastCenterRef = useRef('');
  useEffect(() => {
    const key = `${center[0]},${center[1]}`;
    if (lastCenterRef.current === key) return;
    lastCenterRef.current = key;
    mapRef.current?.easeTo({ center, duration: 1400 });
  }, [center]);
  useEffect(() => {
    const src = mapRef.current?.getSource('farm-draw') as any;
    if (src) src.setData(farmGeoJson(farm, draft, mode === 'rect' || mode === 'polygon', mode === 'rect'));
  }, [farm, draft, mode, ready]);
  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    if (mode === 'polygon') map.doubleClickZoom.disable(); else map.doubleClickZoom.enable();
    // Disable panning before the first mousedown of a draw/edit gesture,
    // otherwise the map pans mid-drag and the shape drifts from the pointer.
    if (mode === 'rect' || mode === 'edit') map.dragPan.disable(); else map.dragPan.enable();
    map.getCanvas().style.cursor = mode === 'idle' ? '' : 'crosshair';
  }, [mode, ready]);
  useEffect(()=>{if(mode!=='rect')rectStartRef.current=null;},[mode]);
  useEffect(()=>{
    const map=mapRef.current;
    if(!readOnly||!map||!farm?.length)return;
    setMode('idle');setDraft([]);
    const fit=()=>map.fitBounds([[Math.min(...farm.map(p=>p[0])),Math.min(...farm.map(p=>p[1]))],[Math.max(...farm.map(p=>p[0])),Math.max(...farm.map(p=>p[1]))]],{padding:50,maxZoom:17,duration:0});
    let frame=0;const observer=new ResizeObserver(()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{map.resize();fit();});});
    if(host.current)observer.observe(host.current);fit();return()=>{observer.disconnect();cancelAnimationFrame(frame);};
  },[readOnly,ready]);

  const undo = () => {
    if (mode === 'polygon' || mode === 'rect') { setDraft((d) => d.slice(0, -1)); return; }
    const prev = historyRef.current.pop();
    if (prev !== undefined) commit(prev, farmKindRef.current);
  };
  const clearFarm = () => { if (farm) { pushHistory(); commit(null, farmKindRef.current); } setDraft([]); setMode('idle'); };
  const finishPolygon = () => {
    if (draft.length >= 3) { pushHistory(); farmKindRef.current = 'polygon'; commit(draft, 'polygon'); }
    setDraft([]); setMode('idle');
  };

  return (
    <div className="farmmap-wrap">
      <div ref={host} className="farmmap" aria-label={t('selectFarm')} />
      <details className="map-water-key"><summary>{language==='uz'?'Ko‘k chiziqlar':language==='ru'?'Синие линии':'Blue lines'}</summary><p>{language==='uz'?'Xaritada qayd etilgan suv yo‘llari; ayrimlari yetishmasligi mumkin. Ko‘k chiziq tugashi suv shu yerda tugashini bildirmaydi.':language==='ru'?'Нанесённые на карту водотоки; данные могут быть неполными. Конец синей линии не означает конец водотока.':'Mapped waterways; some are missing. A blue line ending does not mean the water ends there.'}</p>{waterError&&<p role="status">{language==='uz'?'Yangilash bajarilmadi. Xaritani siljitib qayta urinib ko‘ring.':language==='ru'?'Не удалось обновить слой. Переместите карту для повтора.':'The overlay could not refresh. Move the map to retry.'}</p>}</details>
      {mapError&&<div role="status" className="imagery-error">{language==='en'?'Some satellite tiles could not load. Check your connection or zoom out.':t('imageryError')} <button onClick={()=>{setMapError(false);(mapRef.current?.getSource('imagery') as import('maplibre-gl').RasterTileSource|undefined)?.setTiles(['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}']);}}>{t('retry')}</button></div>}
      {!readOnly&&<div className="draw-tools" role="group" aria-label={t('selectFarm')}>
        {(!farm||mode==='polygon'||mode==='rect')&&<>
        <button aria-pressed={mode==='rect'} className={mode === 'rect' ? 'on' : ''} onClick={() => { setMode(mode === 'rect' ? 'idle' : 'rect'); setDraft([]); }}>{t('rectangle')}</button>
        <button aria-pressed={mode==='polygon'} className={mode === 'polygon' ? 'on' : ''} onClick={() => { setMode(mode === 'polygon' ? 'idle' : 'polygon'); setDraft([]); }}>{language==='en'?'Draw boundary':t('polygon')}</button>
        </>}
        {farm&&<button aria-pressed={mode==='edit'} className={mode === 'edit' ? 'on' : ''} onClick={() => setMode(mode === 'edit' ? 'idle' : 'edit')}>{t('edit')}</button>}
        {mode === 'polygon' && <button onClick={finishPolygon} disabled={draft.length < 3}>{t('finish')} ({draft.length})</button>}
        {(draft.length>0||historyRef.current.length>0)&&<button onClick={undo}>{t('undo')}</button>}
        {(farm||draft.length>0)&&<button onClick={clearFarm}>{t('remove')}</button>}
      </div>}
      {!readOnly&&<p className="draw-hint">
        {mode === 'rect' && t('rectHint')}
        {mode === 'polygon' && t('polygonHint')}
        {mode === 'edit' && (language==='en'?'Drag a corner to adjust your boundary.':t('editHint'))}
        {mode === 'idle' && (farm ? (language==='en'?'Boundary ready. Confirm it, or choose Edit corners.':t('editHint')) : t('fieldHelp'))}
      </p>}
    </div>
  );
}
