'use client';
import {Component,useCallback,useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import dynamic from 'next/dynamic';
import {type CameraTier} from './ReliefScene';
import {loadReliefData,gridSampler,type ReliefData} from './terrain';
import {geodesicAreaM2,interiorPoint,validateFarmPolygon,UZ_BBOX,type LonLat} from './geo';
import {text,locales} from './copy';
import {type Language} from '../../lib/i18n-labels';
import {type UnitSystem} from '../../lib/units';
import {FARM_STORAGE,CROP_IDS,request,parseFarm,type Farm,type Analysis,type Remote,type Nearest,type GroundSnapshot,type SoilResults,type SeasonSnapshot} from './workspace';
import {Glyph,Field,Metric,LineChart,EmptyField,ErrorState,Pending,useFormat} from './ui';
import type {Focus,Layers,Place,Region} from './PlaceScene';
import './atlas.css';
import './museum.css';
const ReliefScene=dynamic(()=>import('./ReliefScene'),{ssr:false});
const FarmMap=dynamic(()=>import('./FarmMap'),{ssr:false,loading:()=> <div className="a-pending" role="status">Map…</div>});
const FarmJourney=dynamic(()=>import('./FarmJourney'),{ssr:false});
const Futures=dynamic(()=>import('./Futures'));
const Groundwater=dynamic(()=>import('./Groundwater'));
const Soil=dynamic(()=>import('./Soil'));
const Passport=dynamic(()=>import('./Passport'));
const Sources=dynamic(()=>import('./Sources'));
const AtlasResearch=dynamic(()=>import('./AtlasResearch'));
const Allocation=dynamic(()=>import('./Allocation'));
type Tool='farm'|'futures'|'groundwater'|'soil'|'passport'|'sources'|'copilot'|'allocation';
class SceneBoundary extends Component<{children:ReactNode;fallback:ReactNode},{failed:boolean}> {state={failed:false};static getDerivedStateFromError(){return {failed:true};}render(){return this.state.failed?this.props.fallback:this.props.children;}}

export default function AtlasExperience() {
  const [language,setLanguage]=useState<Language>('en'),[units,setUnits]=useState<UnitSystem>('metric'),[preferencesReady,setPreferencesReady]=useState(false);
  const t=useCallback((id:string)=>text(id,language),[language]),f=useFormat(language,units);
  const [data,setData]=useState<ReliefData|null>(null),[loading,setLoading]=useState(true),[loadError,setLoadError]=useState(''),[attempt,setAttempt]=useState(0),[webglFailed,setWebglFailed]=useState(false);
  const [mode,setMode]=useState<'relief'|'farm'>('relief'),[tool,setTool]=useState<Tool|null>(null),[tier,setTier]=useState<CameraTier>('national'),[selected,setSelected]=useState<Place|null>(null),[lens,setLens]=useState<number|null>(null);
  const [focus,setFocus]=useState<Focus|null>(null),[zoom,setZoom]=useState({key:0,factor:1}),[reset,setReset]=useState(0),[layers,setLayers]=useState<Layers>({rivers:true,canals:true,reservoirs:true,cities:true,regions:false});
  const [layerOpen,setLayerOpen]=useState(false),[placesOpen,setPlacesOpen]=useState(false),[query,setQuery]=useState(''),[regions,setRegions]=useState<Region[]>([]);
  const [farm,setFarm]=useState<Farm|null>(null),[boundary,setBoundary]=useState<LonLat[]|null>(null),[name,setName]=useState(''),[crop,setCrop]=useState(''),[planting,setPlanting]=useState('');
  const [farmCenter,setFarmCenter]=useState<LonLat>([66.81,39.56]),[nearest,setNearest]=useState<Remote<Nearest[]>>({status:'idle'});
  const [analysis,setAnalysis]=useState<Remote<Analysis>>({status:'idle'}),[ground,setGround]=useState<GroundSnapshot|null>(null),[soil,setSoil]=useState<SoilResults>({}),[season,setSeason]=useState<SeasonSnapshot|null>(null);
  const [efficiency,setEfficiency]=useState(''),[advancedSoil,setAdvancedSoil]=useState(false),[soilValues,setSoilValues]=useState<Record<string,string>>({});
  const [importError,setImportError]=useState(''),[coordinateDraft,setCoordinateDraft]=useState('');
  const analysisController=useRef<AbortController|null>(null),panelTitle=useRef<HTMLHeadingElement>(null),fileInput=useRef<HTMLInputElement>(null);
  const compass=useRef<SVGSVGElement>(null); const updateHeading=useCallback((heading:number)=>{if(compass.current)compass.current.style.transform=`rotate(${heading}rad)`;},[]);
  const updateSeason=useCallback((value:SeasonSnapshot|null)=>setSeason(value),[]),updateGround=useCallback((value:GroundSnapshot|null)=>setGround(value),[]);

  useEffect(()=>{
    try {const l=localStorage.getItem('ariq-language')??sessionStorage.getItem('ariq-intro-language');if(l==='en'||l==='uz'||l==='ru')setLanguage(l);const u=localStorage.getItem('ariq-units');if(u==='metric'||u==='us')setUnits(u);const saved=localStorage.getItem(FARM_STORAGE);if(saved){const parsed=parseFarm(JSON.parse(saved));setFarm(parsed);setBoundary(parsed.boundary);setName(parsed.name);setCrop(parsed.cropId);setPlanting(parsed.plantingDate);}}
    catch{/* Invalid or unavailable browser storage never prevents entering. */}setPreferencesReady(true);
  },[]);
  useEffect(()=>{if(!preferencesReady)return;document.documentElement.lang=language;try{localStorage.setItem('ariq-language',language);localStorage.setItem('ariq-units',units);sessionStorage.setItem('ariq-intro-language',language);}catch{}},[language,units,preferencesReady]);
  useEffect(()=>{if(!preferencesReady)return;try{if(farm)localStorage.setItem(FARM_STORAGE,JSON.stringify(farm));else localStorage.removeItem(FARM_STORAGE);}catch{}},[farm,preferencesReady]);
  useEffect(()=>{let live=true;setLoadError('');setLoading(true);loadReliefData(()=>{}).then(d=>{if(live){setData(d);setLoading(false);(window as unknown as {__ariqRelief:ReliefData}).__ariqRelief=d;}}).catch(e=>{if(live){setLoadError(e.message);setLoading(false);}});return()=>{live=false;};},[attempt]);
  useEffect(()=>{const c=new AbortController();request<{regions:{region:Region}[]}>('/api/water-data/regions',undefined,c.signal).then(d=>setRegions(d.regions.map(r=>r.region))).catch(()=>{});return()=>c.abort();},[]);
  useEffect(()=>{return()=>{analysisController.current?.abort();document.body.style.cursor='';};},[]);
  useEffect(()=>{if(tool)panelTitle.current?.focus();},[tool]);
  useEffect(()=>{const listener=(e:KeyboardEvent)=>{if(e.key==='Escape'){setTool(null);setPlacesOpen(false);setLayerOpen(false);}};window.addEventListener('keydown',listener);return()=>window.removeEventListener('keydown',listener);},[]);
  const farmKey=farm?JSON.stringify(farm):'';
  useEffect(()=>{analysisController.current?.abort();setAnalysis({status:'idle'});setGround(null);setSoil({});setSeason(null);},[farmKey]);
  const rep=useMemo(()=>boundary&&boundary.length>=3?interiorPoint(boundary):null,[boundary]);
  const validation=useMemo(()=>boundary?validateFarmPolygon(boundary):null,[boundary]);
  const nearbyPoint=farm?interiorPoint(farm.boundary):selected?.coordinate;
  useEffect(()=>{
    if(!nearbyPoint){setNearest({status:'idle'});return;}const c=new AbortController();setNearest({status:'loading'});
    request<{results:Nearest[]}>(`/api/water-data/nearest?lat=${nearbyPoint[1]}&lon=${nearbyPoint[0]}&k=3`,undefined,c.signal).then(d=>{if(!c.signal.aborted)setNearest({status:'ready',data:d.results});}).catch(e=>{if(!c.signal.aborted)setNearest({status:'error',error:e.message});});return()=>c.abort();
  },[nearbyPoint?.[0],nearbyPoint?.[1]]);
  const clearResults=()=>{analysisController.current?.abort();setAnalysis({status:'idle'});setGround(null);setSoil({});setSeason(null);};
  const syncFarm=(ring:LonLat[]|null,nextCrop=crop,nextPlanting=planting,nextName=name)=>{
    setBoundary(ring);clearResults();setCoordinateDraft('');
    if(ring&&validateFarmPolygon(ring).ok&&nextCrop&&nextPlanting)setFarm({version:1,name:nextName,boundary:ring,cropId:nextCrop,plantingDate:nextPlanting});else setFarm(null);
  };
  const enterFarm=useCallback((point?:LonLat)=>{setFarmCenter(point??selected?.coordinate??(farm?interiorPoint(farm.boundary):[66.81,39.56]));setMode('farm');setTool('farm');setPlacesOpen(false);},[selected,farm]);
  const onLocal=useCallback((point:LonLat)=>{if(point[0]>=UZ_BBOX.minLon&&point[0]<=UZ_BBOX.maxLon&&point[1]>=UZ_BBOX.minLat&&point[1]<=UZ_BBOX.maxLat)enterFarm(point);},[enterFarm]);
  const onSelect=useCallback((place:Place)=>{setSelected(place);if(place.kind==='focus')setFocus({coordinate:place.coordinate,distance:12,key:Date.now()});},[]);
  const openTool=(next:Tool)=>{setPlacesOpen(false);setLayerOpen(false);if(next==='farm')enterFarm();else setTool(next);};
  const analyze=async()=>{
    if(!farm)return;analysisController.current?.abort();const c=new AbortController();analysisController.current=c;setAnalysis({status:'loading'});
    try {
      const soilInput=advancedSoil?Object.fromEntries(Object.entries(soilValues).map(([k,v])=>[k,Number(v)])):undefined;
      const {recommendationInput}=await import('./workspace');const result=await request<Analysis>('/api/irrigation/recommendation',recommendationInput(farm,efficiency===''?undefined:Number(efficiency)/100,soilInput),c.signal);if(!c.signal.aborted)setAnalysis({status:'ready',data:result});
    }catch(e){if(!c.signal.aborted)setAnalysis({status:'error',error:e instanceof Error?e.message:undefined});}
  };
  const importField=async(file:File)=>{
    try{if(file.size>512000)throw new Error('Field file must be smaller than 500 KB.');const parsed=parseFarm(JSON.parse(await file.text()));setName(parsed.name);setCrop(parsed.cropId);setPlanting(parsed.plantingDate);setBoundary(parsed.boundary);setFarm(parsed);setImportError('');setFarmCenter(interiorPoint(parsed.boundary));setMode('farm');setTool('farm');}catch(e){setImportError(e instanceof Error?e.message:'Invalid field file.');}
  };
  const currentData=analysis.data;
  const panelExpanded=tool&&tool!=='farm';
  if(mode==='farm')return <FarmJourney language={language} onLanguage={setLanguage} onBack={()=>{setMode('relief');setTool(null);}} initialCenter={selected?.coordinate}/>;
  return <main className={`ariq-app museum-atlas  ${tool?'has-panel':''} ${panelExpanded?'expanded-panel':''}`} lang={language}>
    <h1 className="sr-only">ARIQ · {t('atlas')}</h1><a className="skip-app" href="#app-controls">{t('farm')}</a>
    <header className="a-masthead" id="app-controls" tabIndex={-1}><button className="a-brand" aria-label="ARIQ" onClick={()=>{setMode('relief');setTool(null);setReset(s=>s+1);}}><svg viewBox="0 0 40 40" aria-hidden="true"><path d="m20 3 5 11 12 6-12 5-5 12-5-12-12-5 12-6Z"/><path d="M20 11v18M11 20h18"/></svg><span>ARIQ</span></button><div className="a-breadcrumb"><button onClick={()=>{setMode('relief');setTool(null);}}>{t('country')}</button></div>{!tool&&<nav className="a-lens-nav" aria-label={language==='uz'?'Atlas ko‘rinishlari':language==='ru'?'Слои атласа':'Atlas lenses'}>{[[language==='uz'?'Suv infratuzilmasi':language==='ru'?'Водная инфраструктура':'Water infrastructure'],[language==='uz'?'Yer dalillari':language==='ru'?'Данные о земле':'Land evidence'],[language==='uz'?'Tadqiqot va manbalar':language==='ru'?'Исследования и источники':'Research & sources']].map(([label],i)=><button key={label} type="button" aria-pressed={lens===i} className={lens===i?'is-active':''} onClick={()=>{const next=lens===i?null:i;setLens(next);if(next===1)setLayers(v=>({...v,regions:true}));}}>{label}</button>)}</nav>}
      <div className="a-preferences"><details className="atlas-discover"><summary>{t('explore')}</summary><div><button onClick={e=>{e.currentTarget.closest('details')?.removeAttribute('open');setPlacesOpen(true);setTool(null);}}>{t('places')}</button><button onClick={()=>openTool('sources')}>{t('sources')}</button><button onClick={e=>{e.currentTarget.closest('details')?.removeAttribute('open');openTool('allocation');}}>{language==='uz'?'Taqsimlash ssenariysi':language==='ru'?'Сценарий распределения':'Allocation scenario'}</button><a className="discover-link" href="/methods">{language==='uz'?'ARIQ qanday ishlaydi':language==='ru'?'Как работает ARIQ':'How ARIQ works'} ↗</a></div></details><label className="sr-only" htmlFor="a-language">Language</label><select id="a-language" value={language} onChange={e=>setLanguage(e.target.value as Language)}><option value="en">English</option><option value="uz">O‘zbekcha</option><option value="ru">Русский</option></select><label className="sr-only" htmlFor="a-units">Units</label><select hidden={mode==='relief'} id="a-units" value={units} onChange={e=>setUnits(e.target.value as UnitSystem)}><option value="metric">{t('metric')}</option><option value="us">{t('us')}</option></select></div>
    </header>
    <div className="a-geography" aria-label={t('atlas')}>
      {mode==='relief'?(data&&!webglFailed?<SceneBoundary key={attempt} fallback={<div className="a-map-failure"><p>{t('imageryError')}</p><button className="a-button primary" onClick={()=>enterFarm()}>{t('selectFarm')}</button></div>}><ReliefScene data={data} selected={selected?.coordinate??null} tier={tier} onTier={setTier} onSelect={onSelect} onLocal={onLocal} resetSignal={reset} focus={focus} zoom={zoom} layers={layers} regions={regions} language={language} onFailure={()=>setWebglFailed(true)} onHeading={updateHeading}/></SceneBoundary>:<div className="atlas-preparing" role="status"><span className="wordmark">ARIQ</span><h2>{loading?t('loading'):t('networkError')}</h2>{!loading&&<button className="a-button" onClick={()=>{setAttempt(a=>a+1);setWebglFailed(false);}}>{t('retry')}</button>}<button className="text-button" onClick={()=>enterFarm()}>{t('selectFarm')}</button></div>):<FarmMap center={farmCenter} farm={boundary} onFarmChange={ring=>syncFarm(ring)} onIdleClick={p=>setSelected({coordinate:p})} language={language}/>}
    </div>
    {mode==='relief'&&<>

      {!tool&&<AtlasResearch language={language} point={selected?.coordinate} lens={lens} onLensChange={next=>{setLens(next);if(next===1)setLayers(v=>({...v,regions:true}));}} onExplore={()=>enterFarm(selected?.coordinate)} onSources={()=>setTool('sources')} onAllocation={()=>openTool('allocation')}/>}
      <div className="atlas-instruments"><div className="atlas-secondary-tools"><button aria-label={t('reset')} title={t('reset')} onClick={()=>{setReset(v=>v+1);setSelected(null);}}><Glyph name="reset"/></button></div></div>
      {placesOpen&&<div className="places-popover"><Field label={t('search')}><input autoFocus type="search" value={query} onChange={e=>setQuery(e.target.value)}/></Field><div className="places-scroll">{data?.cities.filter(c=>c.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(c=><button key={c.name} onClick={()=>{setSelected({name:c.name,kind:'city',coordinate:[c.lon,c.lat]});setFocus({coordinate:[c.lon,c.lat],distance:12,key:Date.now()});setPlacesOpen(false);}}><Glyph name="pin"/><span>{c.name}</span></button>)}{regions.filter(r=>`${r.nameEn} ${r.nameSource} ${r.nameRu}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(r=><button key={r.id} onClick={()=>{const p:LonLat=[r.centre.longitude,r.centre.latitude];setSelected({name:language==='ru'?r.nameRu:language==='uz'?r.nameSource:r.nameEn,kind:'region',coordinate:p});setFocus({coordinate:p,distance:18,key:Date.now()});setPlacesOpen(false);setLayers(l=>({...l,regions:true}));}}><Glyph name="atlas"/><span>{language==='ru'?r.nameRu:language==='uz'?r.nameSource:r.nameEn}</span></button>)}</div></div>}
      {!tool&&!selected&&<div className="atlas-primary"><button className="a-button primary" onClick={()=>enterFarm()}>{t('selectFarm')}<Glyph name="arrow"/></button></div>}<div className="a-layers"><button className="a-button" aria-expanded={layerOpen} onClick={()=>setLayerOpen(v=>!v)}><Glyph name="layers"/>{t('layers')}</button>{layerOpen&&<div className="layer-choices">{(Object.keys(layers) as (keyof Layers)[]).map(key=><label key={key}><input type="checkbox" checked={layers[key]} onChange={e=>setLayers(v=>({...v,[key]:e.target.checked}))}/><span>{t(key)}</span></label>)}</div>}</div>
      {!tool&&selected&&<aside className="a-place-sheet"><button className="panel-close" aria-label={t('close')} onClick={()=>setSelected(null)}><Glyph name="cross"/></button><span className="evidence-tag">{selected.kind==='city'?t('cities'):selected.kind==='region'?t('regions'):t('selectedLand')}</span><h2>{selected.name||`${selected.coordinate[1].toFixed(3)}° N`}</h2><p>{selected.coordinate[1].toFixed(4)}° N · {selected.coordinate[0].toFixed(4)}° E</p>{typeof selected.capacity==='number'&&<p>{t('designCapacity')}: {f.number(selected.capacity)} {t('millionM3')}</p>}<button className="a-button primary" onClick={()=>enterFarm(selected.coordinate)}>{t('selectFarm')}<Glyph name="arrow"/></button><p className="a-note">{selected.kind==='city'?t('cityNote'):t('reliefNote')}</p></aside>}
      <div className="atlas-orientation" aria-hidden="true"><span>N</span><svg ref={compass} viewBox="0 0 50 50"><path d="m25 7 7 29-7-5-7 5Z" fill="#173e50"/><circle cx="25" cy="25" r="23" fill="none" stroke="#a08048" strokeWidth=".5"/></svg></div>
      <p className="atlas-hint sr-only">{tier==='local'?t('localHint'):t('drag')}</p>
    </>}


    {tool&&<section className={`a-workspace ${tool==='farm'?'field-workspace':''}`} aria-labelledby="workspace-title"><div className="workspace-top"><div><button className="text-button back-atlas" onClick={()=>{setMode('relief');setTool(null);}}>{t('back')}</button><h1 id="workspace-title" ref={panelTitle} tabIndex={-1}>{t(tool)}</h1></div><button className="panel-close" aria-label={t('close')} onClick={()=>setTool(null)}><Glyph name="cross"/></button></div>
      <div className="workspace-content">{tool==='farm'?<div className="field-content">{!boundary?<div className="field-start"><Glyph name="farm" size={48}/><h2>{t('fieldEmpty')}</h2><p>{t('fieldHelp')}</p><p className="a-note">{t('planning')}</p><button className="a-button" onClick={()=>fileInput.current?.click()}>{t('import')}</button></div>:<><div className="farm-area-display"><span>{t('area')}</span><strong>{f.area(geodesicAreaM2(boundary)/10000)}</strong><small>{t('planning')}</small></div><form onSubmit={e=>{e.preventDefault();void analyze();}}>
        <Field label={t('fieldName')}><input maxLength={100} value={name} onChange={e=>{setName(e.target.value);syncFarm(boundary,crop,planting,e.target.value);}}/></Field><div className="form-row"><Field label={t('crop')}><select required value={crop} onChange={e=>{setCrop(e.target.value);syncFarm(boundary,e.target.value);}}><option value="">{t('choose')}</option>{CROP_IDS.map(c=><option key={c} value={c}>{t(`crop.${c}`)}</option>)}</select></Field><Field label={t('planting')}><input required type="date" value={planting} onChange={e=>{setPlanting(e.target.value);syncFarm(boundary,crop,e.target.value);}}/></Field></div>
        {validation&&!validation.ok&&<p className="a-error" role="alert">{t('planning')}: {validation.reason}</p>}
        <details className="optional-assumptions"><summary>{t('advanced')}</summary><Field label={t('efficiency')}><input type="number" min="5" max="100" placeholder="—" value={efficiency} onChange={e=>{analysisController.current?.abort();setAnalysis({status:'idle'});setEfficiency(e.target.value);}}/></Field><label className="check-line"><input type="checkbox" checked={advancedSoil} onChange={e=>{setAnalysis({status:'idle'});setAdvancedSoil(e.target.checked);}}/><span>{t('soilInput')}</span></label>{advancedSoil&&<>{(['fieldCapacity','wiltingPoint','rootDepthM','depletionFraction','initialDepletionMm'] as const).map((key,i)=><Field key={key} label={t(['fc','wp','rootMetres','depletionFraction','initialMm'][i])}><input required type="number" step="any" min="0" value={soilValues[key]??''} onChange={e=>{setAnalysis({status:'idle'});setSoilValues(v=>({...v,[key]:e.target.value}));}}/></Field>)}<p className="a-note">{t('scenario')}</p></>}</details>
        <button className="a-button primary analyze-button" disabled={!farm||!validation?.ok||analysis.status==='loading'}>{analysis.status==='loading'?t('running'):t('analyze')}<Glyph name="water"/></button>
      </form><details className="coordinate-editor"><summary>{t('boundary')}</summary><p className="a-note">{t('lat')} / {t('lon')} · WGS84</p><label className="a-field"><span>GeoJSON [longitude, latitude]</span><textarea rows={5} value={coordinateDraft||JSON.stringify(boundary)} onChange={e=>setCoordinateDraft(e.target.value)}/></label><button className="a-button" onClick={()=>{try{const ring=JSON.parse(coordinateDraft);if(!Array.isArray(ring)||!ring.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)))throw new Error('Invalid coordinates');const v=validateFarmPolygon(ring);if(!v.ok)throw new Error(v.reason);syncFarm(ring);setImportError('');}catch(e){setImportError(e instanceof Error?e.message:'Invalid boundary');}}}>{t('apply')}</button></details>
      {analysis.status==='error'&&<ErrorState t={t} error={analysis.error} retry={()=>void analyze()}/>}{currentData&&<div className="farm-demand" aria-live="polite"><span className="evidence-tag">{t('forecastKind')}</span><h2>{t('forecast')}</h2><div className="a-metrics"><Metric label={t('demand')} value={f.depth(currentData.demand?.totalEtCropMm)}/><Metric label={t('deficit')} value={f.depth(currentData.demand?.totalDeficitMm)}/></div><p className="a-note">{t('noSchedule')}</p>{currentData.forecastDays.length>0&&<LineChart caption={t('forecast')} t={t} format={f.depth} labels={currentData.forecastDays.map(d=>d.date.slice(5))} series={[{name:'ET₀',values:currentData.forecastDays.map(d=>d.et0Mm),color:'#173e50'},{name:t('rain'),values:currentData.forecastDays.map(d=>d.rainMm),color:'#367e85'}]}/>}
        <h3>{t('needed')}</h3><ul className="missing-inputs">{currentData.missingInputs.map(m=><li key={m.field}><strong>{t(`missing.${m.field}`)}</strong><details><summary>{t('details')}</summary><p>{m.effect}</p></details></li>)}</ul><div className="button-row"><button className="a-button" onClick={()=>openTool('futures')}>{t('futures')}<Glyph name="arrow"/></button><button className="a-button" onClick={()=>openTool('passport')}>{t('passport')}</button></div><details><summary>{t('sourcesShort')}</summary><pre>{JSON.stringify(currentData.provenance,null,2)}</pre>{currentData.warnings.map(w=><p key={w}>{w}</p>)}</details></div>}
      <button className="text-button danger" onClick={()=>{setBoundary(null);setFarm(null);clearResults();}}>{t('clear')}</button><p className="a-note">{t('saveNote')}</p></>}
      {importError&&<div role="alert" className="a-error">{importError}</div>}<input ref={fileInput} className="sr-only" type="file" accept=".json,application/json" onChange={e=>{if(e.target.files?.[0])void importField(e.target.files[0]);e.target.value='';}}/></div>:
        tool==='sources'?<Sources language={language}/>:tool==='allocation'?<Allocation language={language}/>:tool==='copilot'?<div className="science-body copilot-body"><Glyph name="copilot" size={50}/><h2>{t('copilotTitle')}</h2><span className="evidence-tag">{t('disabled')}</span><p>{t('disabledNote')}</p><p>{t('copilotHelp')}</p><div className="button-row"><button className="a-button primary" onClick={()=>openTool('futures')}>{t('futures')}</button><button className="a-button" onClick={()=>openTool('passport')}>{t('passport')}</button></div></div>:
        !farm?<EmptyField t={t} onField={()=>enterFarm()}/>:
        tool==='futures'?<Futures key={farmKey} farm={farm} language={language} units={units} onSnapshot={updateSeason}/>:
        tool==='groundwater'?<Groundwater key={farmKey} language={language} units={units} snapshot={ground} onSnapshot={updateGround}/>:
        tool==='soil'?<Soil key={farmKey} farm={farm} language={language} units={units} results={soil} onResults={setSoil} season={season}/>:
        <Passport farm={farm} language={language} units={units} recommendation={analysis.data} groundwater={ground??undefined} soil={soil} season={season??undefined} nearest={nearest.data??[]}/>}
      </div>
    </section>}
    <footer className="a-attribution"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a></footer>
  </main>;
}
