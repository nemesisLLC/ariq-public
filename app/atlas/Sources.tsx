'use client';
import {useEffect,useState} from 'react';
import type {Language} from '../../lib/i18n-labels';
import {text} from './copy';
import {local} from './product';
import {request,type Freshness,type Remote} from './workspace';
import {ErrorState,Pending,LineChart,useFormat} from './ui';
type Series={id:string;indicator:string;unit:string;measurementKind:string;sourceUrl?:string;sourceUrls?:string[];values:{year?:number;date?:string;value:number|null}[]};
type Dataset={id:string;title:string;url:string;license:string;status:string;retrievedAt?:string;limits:string};
export default function Sources({language}:{language:Language}) {
  const l=local(language),t=(id:string)=>text(id,language),f=useFormat(language,'metric');
  const [state,setState]=useState<Remote<{sources:Freshness[];datasets:Dataset[];series:Series[]}>>({status:'loading'}),[attempt,setAttempt]=useState(0),[selected,setSelected]=useState('');
  useEffect(()=>{const c=new AbortController();setState({status:'loading'});Promise.all([request<{sources:Freshness[]}>('/api/data-refresh',undefined,c.signal),request<{catalog:{datasets:Dataset[]}}>('/api/water-data/catalog',undefined,c.signal),request<{results:Series[]}>('/api/water-data/series',undefined,c.signal)]).then(([fresh,catalog,series])=>{if(!c.signal.aborted)setState({status:'ready',data:{sources:fresh.sources,datasets:catalog.catalog.datasets,series:series.results}});}).catch(e=>{if(!c.signal.aborted)setState({status:'error',error:e.message});});return()=>c.abort();},[attempt]);
  const series=state.data?.series.find(s=>s.id===selected),points=series?.values.filter(p=>typeof p.value==='number')??[];
  return <div className="science-body sources-body"><div className="science-lead"><h2>{t('briefingTitle')}</h2><p>{t('briefingNote')}</p><a href="/methods">{l("How ARIQ works","ARIQ qanday ishlaydi","Как работает ARIQ")} ↗</a></div>
    {state.status==='loading'&&<Pending t={t}/>}{state.status==='error'&&<ErrorState t={t} error={state.error} retry={()=>setAttempt(a=>a+1)}/>}
    <div className="evidence-key">{['observed','reported','forecastKind','historicalKind','modelEstimate','assumption','simulated'].map(kind=><span key={kind}>{t(kind)}</span>)}</div>
    {state.data?.sources.map(s=><details className="freshness-row" key={s.sourceId}><summary><span><strong>{s.name}</strong><small>{s.canonicalFor}</small></span><span className={`source-status ${s.state}`}>{t({live:'live',stale:'stale','never-updated':'never','manual-review':'manual'}[s.state])}</span></summary><div className="source-detail"><p>{s.lastUpdated?`${t('lastUpdated')}: ${f.date(s.lastUpdated)}`:t('never')}</p><p>{s.measurementKind}</p><p>{s.note}</p><p>{t('license')}: {s.license}</p><a href={s.sourceUrl} target="_blank" rel="noreferrer">{t('source')}</a></div></details>)}
    {state.data&&<><h3>{t('historicalKind')}</h3><label className="a-field"><span>{t('source')}</span><select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">{t('choose')}</option>{state.data.series.map(s=><option key={s.id} value={s.id}>{s.indicator} ({s.unit})</option>)}</select></label>{series&&<><p className="evidence-tag">{series.measurementKind} · {series.unit}</p><LineChart t={t} caption={series.indicator} format={n=>f.number(n,2)} labels={points.map((p,i)=>String(p.year??p.date??i+1))} series={[{name:series.indicator,color:'#367e85',values:points.map(p=>p.value!)}]}/>{(series.sourceUrl??series.sourceUrls?.[0])&&<a href={series.sourceUrl??series.sourceUrls?.[0]} target="_blank" rel="noreferrer">{t('source')}</a>}</>}
    <h3>{t('sourcesShort')}</h3>{state.data.datasets.map(d=><details className="dataset-detail" key={d.id}><summary>{d.title}</summary><p>{d.limits}</p><p>{t('license')}: {d.license}</p>{d.retrievedAt&&<p>{t('lastUpdated')}: {d.retrievedAt}</p>}<a href={d.url} target="_blank" rel="noreferrer">{t('source')}</a></details>)}</>}
  </div>;
}
