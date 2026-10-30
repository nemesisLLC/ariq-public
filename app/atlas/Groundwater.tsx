'use client';
import {useEffect,useRef,useState} from 'react';
import type {Language} from '../../lib/i18n-labels';
import {metresToFeet,feetToMetres,type UnitSystem} from '../../lib/units';
import type {GroundwaterObservation} from '../../lib/groundwater';
import {request,type Remote,type GroundwaterResult,type GroundSnapshot,type TrendResult} from './workspace';
import {text} from './copy';
import {Field,ErrorState,Pending,Metric,LineChart,useFormat} from './ui';
import {local} from './product';

export default function Groundwater({language,units,snapshot,onSnapshot,rootDepth,suggestedTexture}:{language:Language;units:UnitSystem;snapshot:GroundSnapshot|null;onSnapshot:(value:GroundSnapshot|null)=>void;rootDepth?:number;suggestedTexture?:string}) {
  const l=local(language),t=(id:string)=>text(id,language),f=useFormat(language,units),[depth,setDepth]=useState(snapshot?String(snapshot.inputs.depthToWaterM):''),[root,setRoot]=useState(snapshot?String(snapshot.inputs.rootDepthM):rootDepth===undefined?'':String(rootDepth)),[ec,setEc]=useState(snapshot?.inputs.groundwaterEcDsM===undefined?'':String(snapshot.inputs.groundwaterEcDsM)),[texture,setTexture]=useState(snapshot?.inputs.texture??suggestedTexture??'');
  const [state,setState]=useState<Remote<GroundwaterResult>>({status:snapshot?'ready':'idle',data:snapshot?.result});
  const [rows,setRows]=useState<{date:string;depth:string}[]>([{date:'',depth:''},{date:'',depth:''},{date:'',depth:''}]);
  const [mode,setMode]=useState<'observed'|'user-supplied-scenario'>('user-supplied-scenario'),[measurementSource,setMeasurementSource]=useState(''),[measurementDate,setMeasurementDate]=useState('');
  const [source,setSource]=useState(''),[trend,setTrend]=useState<Remote<TrendResult>>({status:'idle'});
  const controller=useRef<AbortController|null>(null),trendController=useRef<AbortController|null>(null);
  useEffect(()=>()=>{controller.current?.abort();trendController.current?.abort();},[]);
  const lengthUnit=units==='us'?'ft':'m',toM=(n:string)=>Number(n),fromM=(n:number)=>units==='us'?metresToFeet(n):n;
  const clear=()=>{controller.current?.abort();setState({status:'idle'});onSnapshot(null);};
  const run=async()=>{
    controller.current?.abort();const c=new AbortController();controller.current=c;setState({status:'loading'});onSnapshot(null);
    const inputs={depthKind:mode,source:measurementSource,observedAt:measurementDate,depthToWaterM:toM(depth),rootDepthM:toM(root),texture,...(ec===''?{}:{groundwaterEcDsM:Number(ec)})};
    try {const result=await request<GroundwaterResult>('/api/groundwater',inputs,c.signal);if(!c.signal.aborted){setState({status:'ready',data:result});onSnapshot({result,inputs});}}
    catch(error){if(!c.signal.aborted)setState({status:'error',error:error instanceof Error?error.message:undefined});}
  };
  const runTrend=async()=>{
    trendController.current?.abort();const c=new AbortController();trendController.current=c;setTrend({status:'loading'});
    try {
      const observations:GroundwaterObservation[]=rows.filter(r=>r.date&&r.depth!=='').map(r=>({observedAt:r.date,depthToWaterM:toM(r.depth),source,kind:'observed'}));
      if(observations.length<3||new Set(observations.map(o=>o.observedAt)).size<3)throw new Error('Supply at least three different observation dates.');
      const response=await request<{trend:TrendResult}>('/api/groundwater',{observations},c.signal);if(!c.signal.aborted)setTrend({status:'ready',data:response.trend});
    }catch(error){if(!c.signal.aborted)setTrend({status:'error',error:error instanceof Error?error.message:undefined});}
  };
  useEffect(()=>{if(mode!=='user-supplied-scenario'||depth===''||root===''||!texture)return;const timer=setTimeout(()=>void run(),220);return()=>{clearTimeout(timer);controller.current?.abort();};},[depth,root,texture,ec,mode]);
  const result=state.data,d=result?.depth.valueM??2,r=snapshot?.inputs.rootDepthM??.6,extent=Math.max(3,d+.8,r+.8),groundY=43,scale=200/extent;
  return <div className="science-body"><div className="science-lead"><h2>{t('groundwaterIntro')}</h2><p>{t('gwNote')}</p>{language==='en'&&<p>Use the depth from a well or monitoring record near your field. Root depth is how far your crop’s roots reach. If you do not know these values, ask your local irrigation adviser; no water table will be guessed.</p>}</div><div className="groundwater-layout">
    <form className="science-inputs" onSubmit={e=>{e.preventDefault();void run();}}><div className="ground-mode"><button type="button" className="a-button" aria-pressed={mode==='user-supplied-scenario'} onClick={()=>{clear();setMode('user-supplied-scenario');}}>{l('Explore an assumption','Taxminni o‘rganish','Исследовать допущение')}</button><button type="button" className="a-button" aria-pressed={mode==='observed'} onClick={()=>{clear();setMode('observed');}}>{l('Add a measurement','O‘lchov qo‘shish','Добавить измерение')}</button></div>{mode==='observed'&&<><Field label={l('Measurement source','O‘lchov manbasi','Источник измерения')}><input required value={measurementSource} onChange={e=>{clear();setMeasurementSource(e.target.value);}}/></Field><Field label={t('date')}><input required type="date" value={measurementDate} onChange={e=>{clear();setMeasurementDate(e.target.value);}}/></Field></>}<span className="evidence-tag">{mode==='observed'?t('observed'):t('scenario')}</span><Field label={`${t('depth')} (${lengthUnit})`}><input required type="number" step="any" min="0" max={fromM(300)} value={depth===''?'':fromM(Number(depth))} onChange={e=>{clear();setDepth(e.target.value===''?'':String(units==='us'?feetToMetres(Number(e.target.value)):Number(e.target.value)));}}/></Field>
      <Field label={`${t('roots')} (${lengthUnit})`}><input required type="number" step="any" min={fromM(.05)} max={fromM(3)} value={root===''?'':fromM(Number(root))} onChange={e=>{clear();setRoot(e.target.value===''?'':String(units==='us'?feetToMetres(Number(e.target.value)):Number(e.target.value)));}}/></Field>
      <Field label={t('texture')}><select required value={texture} onChange={e=>{clear();setTexture(e.target.value);}}><option value="">{t('choose')}</option>{['sand','sandy-loam','loam','clay-loam','clay'].map(v=><option value={v} key={v}>{t(`texture.${v}`)}</option>)}</select></Field>{!snapshot&&suggestedTexture&&texture===suggestedTexture&&<p className="a-note">{l('Texture prefilled from your field’s modelled soil estimate. Change it if you know your soil better.','Tekstura dalangizning tuproq model bahosidan oldindan to‘ldirildi. Tuproqni yaxshi bilsangiz o‘zgartiring.','Текстура предзаполнена из модельной оценки почвы вашего поля. Измените, если знаете почву лучше.')}</p>}
      <Field label={t('ec')} note={t('optional')}><input type="number" step="any" min="0" max="40" value={ec} onChange={e=>{clear();setEc(e.target.value);}}/></Field>
      <button className="a-button primary" disabled={state.status==='loading'}>{t('assess')}</button>
    </form><div className="groundwater-visual">{mode==='user-supplied-scenario'&&depth!==''&&<label className="field-time">{l('Assumed depth','Taxminiy chuqurlik','Предполагаемая глубина')} · {fromM(Number(depth)).toFixed(2)} {lengthUnit}<input aria-label={l('Assumed water-table depth','Taxminiy yer osti suvi chuqurligi','Предполагаемая глубина грунтовых вод')} type="range" min="0" max={Math.max(10,Number(depth))} step=".05" value={depth} onChange={e=>{clear();setDepth(e.target.value);}}/></label>}
      <svg viewBox="0 0 560 300" role="img" aria-label={t('scenario')}><defs><pattern id="soilgrain" width="19" height="17" patternUnits="userSpaceOnUse"><path d="m2 7 3 1m9 5 2-1m-1-10 1 1" stroke="#9b835b" opacity=".35"/></pattern><pattern id="watergrain" width="24" height="10" patternUnits="userSpaceOnUse"><path d="M0 5q6-4 12 0t12 0" fill="none" stroke="#6caba9" strokeWidth=".6"/></pattern></defs>
        <path d="M35 43H505V250H35Z" fill="#d6c6a6"/><path d="M35 43H505V250H35Z" fill="url(#soilgrain)"/>
        {result&&<><path d={`M35 ${groundY+d*scale}H505V250H35Z`} fill="#80b5b9"/><path d={`M35 ${groundY+d*scale}H505V250H35Z`} fill="url(#watergrain)"/><line x1="35" x2="505" y1={groundY+d*scale} y2={groundY+d*scale} stroke="#26748d" strokeWidth="2"/>
          {[110,190,310,390].map(x=><path key={x} d={`M${x} 35v${r*scale+8}m0 -${r*scale/2} -15 15m15 -5 12 12`} fill="none" stroke="#79724c" strokeWidth="1.5"/>)}
          <text x="42" y={Math.min(282,groundY+d*scale+20)} fontSize="13" fill="#173e50">{f.number(fromM(d))} {lengthUnit} · {mode==='observed'?t('observed'):t('scenario')}</text></>}
        <path d="M35 43H505" stroke="#716b4c" strokeWidth="3"/><text x="35" y="22" fontSize="14" fill="#173e50">{l('Illustrative cross-section','Ko‘rgazmali kesim','Иллюстративный разрез')}</text>
        {!result&&<text x="270" y="150" textAnchor="middle" fill="#173e50" fontSize="16">{t('noMeasurement')}</text>}
      </svg>
      {state.status==='loading'&&<Pending t={t}/>}{state.status==='error'&&<ErrorState t={t} error={state.error}/>}
      {result&&<><div className="a-metrics"><Metric label={t('capillary')} value={`${f.depth(result.capillaryRise.rateMmDay.low)} – ${f.depth(result.capillaryRise.rateMmDay.high)}`} note={t('perDay')}/><Metric label={t('waterlogging')} value={t(result.risks.waterlogging.level)}/><Metric label={t('salinity')} value={t(result.risks.salinity.level)}/></div><p className="a-note">{t('modelEstimate')} · FAO-56 / FAO-29</p><details><summary>{t('details')}</summary><p>{result.capillaryRise.note}</p><p>{result.risks.waterlogging.reason}</p><p>{result.risks.salinity.reason}</p></details></>}
    </div></div>
    <details className="observation-form"><summary>{t('observations')}</summary><p>{t('trendNote')}</p><form onSubmit={e=>{e.preventDefault();void runTrend();}}><Field label={t('observationSource')}><input required maxLength={200} value={source} onChange={e=>{setSource(e.target.value);trendController.current?.abort();setTrend({status:'idle'});}}/></Field>{rows.map((row,i)=><div className="form-row" key={i}><Field label={t('date')}><input type="date" required value={row.date} onChange={e=>{setRows(rows.map((r,k)=>k===i?{...r,date:e.target.value}:r));trendController.current?.abort();setTrend({status:'idle'});}}/></Field><Field label={`${t('depth')} (${lengthUnit})`}><input required type="number" step="any" min="0" value={row.depth===''?'':fromM(Number(row.depth))} onChange={e=>{setRows(rows.map((r,k)=>k===i?{...r,depth:e.target.value===''?'':String(units==='us'?feetToMetres(Number(e.target.value)):Number(e.target.value))}:r));trendController.current?.abort();setTrend({status:'idle'});}}/></Field></div>)}<div className="button-row"><button className="a-button" type="button" disabled={rows.length>=30} onClick={()=>{trendController.current?.abort();setTrend({status:'idle'});setRows([...rows,{date:'',depth:''}]);}}>{t('add')}</button><button className="a-button primary" disabled={trend.status==='loading'}>{t('trend')}</button></div></form>
      {trend.status==='error'&&<ErrorState t={t} error={trend.error}/>}{trend.data&&<><Metric label={t('trend')} value={trend.data.trendMPerYear===null?'—':f.number(fromM(trend.data.trendMPerYear),3)} unit={`${lengthUnit}/yr`}/><LineChart t={t} format={n=>`${f.number(fromM(n))} ${lengthUnit}`} caption={t('observations')} labels={[...rows].sort((a,b)=>a.date.localeCompare(b.date)).map(r=>r.date)} series={[{name:t('depth'),color:'#367e85',values:[...rows].sort((a,b)=>a.date.localeCompare(b.date)).map(r=>toM(r.depth))}]}/></>}
    </details>
  </div>;
}
