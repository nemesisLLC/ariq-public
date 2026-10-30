'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import type {FarmProfile} from '../../lib/farm-profile';
import {local} from './product';
import RootZone from './RootZone';
import type {Language} from '../../lib/i18n-labels';
import type {UnitSystem} from '../../lib/units';
import {SOIL_PRESETS,type SeasonInput} from '../../lib/irrigation/season';
import {interiorPoint,geodesicAreaM2} from './geo';
import {request,type Farm,type Remote,type SeasonResponse,type SeasonSnapshot,type Comparison} from './workspace';
import {text} from './copy';
import {Field,ErrorState,Pending,Metric,LineChart,useFormat} from './ui';

export default function Futures({farm,language,units,onSnapshot,profile}:{profile?:FarmProfile;farm:Farm;language:Language;units:UnitSystem;onSnapshot:(value:SeasonSnapshot|null)=>void}) {
  const l=local(language),t=(id:string)=>text(id,language),f=useFormat(language,units);
  const [soilId,setSoilId]=useState(profile?.autoSoilForIrrigation?'field-profile':'soil.loam-reference'),[consent,setConsent]=useState(false),[eff,setEff]=useState(''),[supply,setSupply]=useState(''),[years,setYears]=useState('2022, 2023'),[planting,setPlanting]=useState(farm.plantingDate);
  const [initial,setInitial]=useState(''),[potential,setPotential]=useState(''),[day,setDay]=useState(0);
  const [cut,setCut]=useState(30),[rain,setRain]=useState(0),[evap,setEvap]=useState(0),[modifiedEff,setModifiedEff]=useState('');
  const [historical,setHistorical]=useState<Remote<{response:SeasonResponse;base:SeasonInput}>>({status:'idle'});
  const [comparison,setComparison]=useState<Remote<Comparison>>({status:'idle'});
  const active=useRef<AbortController|null>(null),worker=useRef<Worker|null>(null),sequence=useRef(0),expected=useRef(0);
  const preset=SOIL_PRESETS.find(s=>s.id===soilId)??SOIL_PRESETS[1];
  const fromProfile=soilId==='field-profile'&&profile?.autoSoilForIrrigation;
  const soil={...(fromProfile?{fieldCapacity:fromProfile.fieldCapacity,wiltingPoint:fromProfile.wiltingPoint,rootDepthM:fromProfile.rootDepthM,depletionFraction:fromProfile.depletionFraction,targetDepletionFraction:.2}:preset),initialDepletionMm:Number(initial)};
  const soilKind=fromProfile?'modeled-estimate' as const:'illustrative-reference' as const;
  useEffect(()=>{return()=>{active.current?.abort();worker.current?.terminate();worker.current=null;};},[]);
  useEffect(()=>{
    if(!historical.data||historical.status!=='ready')return;
    const {base,response}=historical.data;
    const id=++sequence.current;expected.current=id;setComparison({status:'loading'});onSnapshot(null);
    const timer=setTimeout(()=>{
      try {
        if(!worker.current)worker.current=new Worker(new URL('./season.worker.ts',import.meta.url));
        worker.current.onmessage=(event:MessageEvent<{id:number;result?:Comparison;error?:string}>)=>{
          if(event.data.id!==expected.current)return;
          if(event.data.error){setComparison({status:'error',error:event.data.error});return;}
          const result=event.data.result!;setComparison({status:'ready',data:result});onSnapshot({comparison:result,base,modified,provenance:response.provenance,years:response.ensemble.years});
        };
        worker.current.onerror=()=>{if(id===expected.current)setComparison({status:'error',error:'The background calculation could not run. Reload this view and try again.'});};
        const modified:SeasonInput={...base,applicationEfficiency:modifiedEff===''?base.applicationEfficiency:Number(modifiedEff)/100,perturbation:{rainFactor:1+rain/100,et0Factor:1+evap/100},...(base.strategy?.seasonSupplyM3!==undefined?{strategy:{...base.strategy,seasonSupplyM3:base.strategy.seasonSupplyM3*(1-cut/100)}}:{})};
        worker.current.postMessage({id,base,modified});
      } catch(error){setComparison({status:'error',error:error instanceof Error?error.message:'Worker unavailable.'});}
    },180);
    return()=>{clearTimeout(timer);expected.current=++sequence.current;};
  },[historical,cut,rain,evap,modifiedEff,onSnapshot]);
  const invalidate=()=>{active.current?.abort();expected.current=++sequence.current;setHistorical({status:'idle'});setComparison({status:'idle'});onSnapshot(null);};
  const run=async()=>{
    active.current?.abort();const controller=new AbortController();active.current=controller;setHistorical({status:'loading'});setComparison({status:'idle'});onSnapshot(null);
    try {
      const analogYears=years.split(',').map(v=>Number(v.trim()));
      if(analogYears.length<2||analogYears.length>5||new Set(analogYears).size!==analogYears.length||analogYears.some(y=>!Number.isInteger(y)||y<1960||y>=new Date().getFullYear()-1))throw new Error('Choose 2–5 different completed historical start-years, from 1960 onward.');
      const [longitude,latitude]=interiorPoint(farm.boundary),areaHa=geodesicAreaM2(farm.boundary)/10000;
      const response=await request<SeasonResponse>('/api/irrigation/season',{latitude,longitude,areaHa,cropId:farm.cropId,plantingDate:planting,applicationEfficiency:Number(eff)/100,soil,soilKind,analogYears,...(potential?{potentialYieldTPerHa:Number(potential)}:{}),...(supply!==''?{supply:{seasonSupplyM3:Number(supply)}}:{})},controller.signal);
      if(controller.signal.aborted)return;
      // Reuse the returned median weather with the exact, explicitly accepted reference inputs.
      const base:SeasonInput={cropId:farm.cropId,areaHa,applicationEfficiency:Number(eff)/100,soil,soilKind,...(potential?{potentialYieldTPerHa:Number(potential)}:{}),weather:response.dailyBaseline.map(d=>({date:d.date,et0Mm:d.et0Mm,rainMm:d.rainMm})),weatherKind:'historical-analog',analogYear:response.medianAnalogYear,...(supply!==''?{strategy:{seasonSupplyM3:Number(supply)}}:{})};
      setHistorical({status:'ready',data:{response,base}});
    }catch(error){if(!controller.signal.aborted)setHistorical({status:'error',error:error instanceof Error?error.message:undefined});}
  };
  const result=comparison.data;
  return <div className="science-body futures-body"><div className="science-lead"><h2>{t('futuresIntro')}</h2><p>{t('futuresNote')}</p></div>
    <div className="futures-layout"><details className="season-setup-disclosure" open={!result}><summary>{l("Baseline assumptions and historical weather","Asosiy taxminlar va tarixiy ob-havo","Исходные допущения и историческая погода")}</summary><form className="scenario-setup" onSubmit={e=>{e.preventDefault();void run();}}>
      <h3>{t('baseline')}</h3>
      <Field label={t('planting')}><input type="date" required value={planting} onChange={e=>{invalidate();setPlanting(e.target.value);}}/></Field>
      <Field label={t('referenceSoil')}><select value={soilId} onChange={e=>{invalidate();setConsent(false);setSoilId(e.target.value);}}>{profile?.autoSoilForIrrigation&&<option value="field-profile">{l('FieldDNA modelled soil','FieldDNA tuproq modeli','Модель почвы FieldDNA')}</option>}{SOIL_PRESETS.map((s,i)=><option key={s.id} value={s.id}>{t(['sandy','loam','clay'][i])}</option>)}</select></Field>
      <details><summary>{t('details')}</summary><p className="a-note">FC {soil.fieldCapacity} · WP {soil.wiltingPoint} m³/m³ · {t('roots')} {soil.rootDepthM} m</p></details>
      <Field label={l('Assumed initial depletion (mm)','Boshlang‘ich tanqislik taxmini (mm)','Предполагаемый начальный дефицит (мм)')}><input required type="number" min="0" max="1000" step="any" value={initial} onChange={e=>{invalidate();setInitial(e.target.value);}}/></Field><p className="a-note">{l('Explicit scenario input. Target depletion fraction is 0.2, an irrigation strategy assumption.','Aniq ssenariy ma’lumoti. Maqsadli tanqislik ulushi 0.2 — sug‘orish strategiyasi taxmini.','Явный вход сценария. Целевая доля дефицита 0,2 — допущение стратегии полива.')}</p><Field label={l('Potential yield baseline (t/ha, optional)','Potensial hosil (t/ha, ixtiyoriy)','Потенциальная урожайность (т/га, необязательно)')}><input type="number" min=".01" max="100" step="any" value={potential} onChange={e=>{invalidate();setPotential(e.target.value);}}/></Field><label className="check-line"><input type="checkbox" checked={consent} onChange={e=>{invalidate();setConsent(e.target.checked);}} required/><span>{t('consent')}</span></label>
      <Field label={t('efficiency')}><input type="number" min="5" max="100" required value={eff} placeholder="—" onChange={e=>{invalidate();setEff(e.target.value);}}/></Field>
      <Field label={`${t('supply')} (m³)`} note={t('optional')}><input type="number" min="0" max="1000000000" value={supply} placeholder="—" onChange={e=>{invalidate();setSupply(e.target.value);}}/></Field>
      <Field label={t('years')}><input value={years} required onChange={e=>{invalidate();setYears(e.target.value);}}/></Field>
      <button className="a-button primary" disabled={!consent||eff===''||initial===''||historical.status==='loading'}>{historical.status==='loading'?t('running'):t('runSeason')}</button>
      <p className="a-note">{t('historical')}</p>
    </form></details><div className="scenario-results">
      {historical.status==='loading'&&<Pending t={t}/>}{historical.status==='error'&&<ErrorState t={t} error={historical.error} retry={()=>void run()}/>}
      <div className="scenario-dials" aria-label={t('modified')}>
        <h3>{t('modified')}</h3>
        <Field label={`${t('reduction')} · ${cut}%`} note={supply===''?t('noSupplyCut'):undefined}><input type="range" min="0" max="90" step="5" value={cut} disabled={supply===''} onChange={e=>setCut(Number(e.target.value))}/></Field>
        <Field label={`${t('rainFactor')} · ${rain>0?'+':''}${rain}%`}><input type="range" min="-80" max="80" step="5" value={rain} onChange={e=>setRain(Number(e.target.value))}/></Field>
        <Field label={`${t('etFactor')} · ${evap>0?'+':''}${evap}%`}><input type="range" min="-30" max="50" step="5" value={evap} onChange={e=>setEvap(Number(e.target.value))}/></Field>
        <Field label={t('modifiedEff')}><input type="number" min="5" max="100" placeholder={eff||'—'} value={modifiedEff} onChange={e=>setModifiedEff(e.target.value)}/></Field>
      </div>
      {comparison.status==='loading'&&<Pending t={t}/>}{comparison.status==='error'&&<ErrorState t={t} error={comparison.error}/>}
      {!result&&historical.status==='idle'&&<div className="scenario-empty"><svg viewBox="0 0 500 130" aria-hidden="true"><path d="M0 85C70 85 90 20 150 40S230 100 290 60 420 70 500 25" fill="none" stroke="#a08048" strokeWidth="1.5" strokeDasharray="4 7"/></svg><p>{t('noResult')}</p></div>}
      {result&&<div aria-live="polite"><label className="field-time">{result.modified.daily[Math.min(day,result.modified.daily.length-1)]?.date}<input aria-label={l('Season day','Mavsum kuni','День сезона')} type="range" min="0" max={Math.max(0,result.modified.daily.length-1)} value={Math.min(day,result.modified.daily.length-1)} onChange={e=>setDay(Number(e.target.value))}/></label><div className="season-twins">{([['baseline',result.baseline],['modified',result.modified]] as const).map(([key,value])=>{const d=value.daily[Math.min(day,value.daily.length-1)];return <section key={key}><h3>{t(key)}</h3>{d&&<><RootZone rain={d.effectiveRainMm} crop={d.etCropAdjMm} depletion={d.endDepletionMm} capacity={value.rootZone.totalAvailableMm} language={language}/><dl className="field-facts"><div><dt>{t('depletion')}</dt><dd>{f.depth(d.endDepletionMm)}</dd></div><div><dt>{t('irrigation')}</dt><dd>{f.depth(d.irrigationNetMm)}</dd></div><div><dt>{t('drainage')}</dt><dd>{f.depth(d.drainageMm)}</dd></div><div><dt>{t('stressDays')}</dt><dd>{d.stress?l('Stress','Stress','Стресс'):l('No stress','Stress yo‘q','Нет стресса')}</dd></div></dl></>}</section>;})}</div><div className="comparison-heading"><span>{t('baseline')} / {t('modified')}</span><span>ERA5 · {historical.data?.response.medianAnalogYear}</span></div>
        <div className="a-metrics"><Metric label={t('retained')} value={`${f.number(result.baseline.yieldImpact.relativeYieldRetained*100)} / ${f.number(result.modified.yieldImpact.relativeYieldRetained*100)}`} unit="%"/><Metric label={t('stressDays')} value={`${result.baseline.totals.stressDays} / ${result.modified.totals.stressDays}`}/><Metric label={t('gross')} value={`${f.volume(result.baseline.totals.irrigationGrossM3)} / ${f.volume(result.modified.totals.irrigationGrossM3)}`}/></div>
        {result.modified.yieldImpact.estimatedYieldTPerHa!==null&&<p>{l('Water-related yield from your supplied baseline','Siz kiritgan asosiy hosildan suvga bog‘liq hosil','Урожайность по водному фактору от заданного потенциала')}: {f.number(result.baseline.yieldImpact.estimatedYieldTPerHa!)} / {f.number(result.modified.yieldImpact.estimatedYieldTPerHa)} t/ha · {l('Other stresses are excluded.','Boshqa stresslar hisobga olinmagan.','Другие виды стресса не учтены.')}</p>}
        <LineChart t={t} format={f.depth} caption={t('depletion')} labels={result.baseline.daily.map(d=>d.date)} series={[{name:t('baseline'),values:result.baseline.daily.map(d=>d.endDepletionMm),color:'#173e50'},{name:t('modified'),values:result.modified.daily.map(d=>d.endDepletionMm),color:'#a08048'}]}/>
        <LineChart t={t} format={f.depth} caption={t('demand')} labels={result.baseline.daily.map(d=>d.date)} series={[{name:t('seasonal'),values:result.modified.daily.map(d=>d.etCropMm),color:'#173e50'},{name:t('irrigation'),values:result.modified.daily.map(d=>d.irrigationNetMm),color:'#367e85'}]}/>
        <h3>{t('stages')}</h3><div className="stage-strip">{result.modified.stages.map(s=><div key={s.stage} style={{flex:s.days}}><span>{t(s.stage==='initial'?'initialStage':s.stage)}</span><strong>{s.days}</strong><small>{t('day')} · {s.stressDays} {t('stressDays')}</small></div>)}</div>
        <details><summary>{t('event')} · {result.modified.totals.irrigationEvents}</summary><div className="table-scroll"><table><thead><tr><th>{t('date')}</th><th>{t('irrigation')}</th></tr></thead><tbody>{result.modified.daily.filter(d=>d.irrigationNetMm>0).map(d=><tr key={d.date}><td>{f.date(d.date)}</td><td>{f.depth(d.irrigationNetMm)}</td></tr>)}</tbody></table></div></details>
        {historical.data?.response.sensitivity&&<details><summary>{l('Which changes matter most?','Qaysi o‘zgarish muhimroq?','Какие изменения важнее?')}</summary>{historical.data.response.sensitivity.factors.map(factor=><p key={factor.factorId}>{factor.factorId} · {factor.change} · Δ {f.number(factor.deltaRelativeYield*100)}%</p>)}</details>}
        <h3>{t('years')}</h3><div className="analog-bars">{historical.data?.response.ensemble.years.map(y=><div key={y.year}><span>{y.year}</span><i style={{width:`${y.yieldImpact.relativeYieldRetained*100}%`}}/><strong>{f.number(y.yieldImpact.relativeYieldRetained*100)}%</strong></div>)}</div>
        <p className="a-note">{t('historical')}</p><p className="a-note">{t('waterOnly')}</p>
        <details><summary>{t('details')}</summary>{result.modified.warnings.map(w=><p key={w}>{t(w)}</p>)}<a href={historical.data?.response.provenance.weather.sourceUrls[0]} target="_blank" rel="noreferrer">Open-Meteo ERA5</a><p>FAO-56 / FAO-33 / FAO-66</p></details>
      </div>}
    </div></div>
  </div>;
}
