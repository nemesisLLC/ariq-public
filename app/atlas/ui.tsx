'use client';
import { useState, type ReactNode } from 'react';
import { convertArea,convertDepth,convertVolume, type UnitSystem } from '../../lib/units';
import type { Language } from '../../lib/i18n-labels';
import {locales,text,type Translator} from './copy';
import type { LonLat } from './geo';

export function Glyph({name,size=20}:{name:string;size?:number}) {
  const paths:Record<string,ReactNode>={
    atlas:<><path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2Z"/><path d="M9 3v16M15 5v16"/></>,
    farm:<><path d="m3 8 10-5 8 7-4 11-12-3Z"/><path d="m6 13 10-5m-7 9 10-5"/></>,
    futures:<><path d="M3 18h18M4 14l5-5 5 3 6-8"/><path d="M16 4h4v4"/></>,
    groundwater:<><path d="M3 5h18M4 9h16M7 13c0 5 10 5 10 0M12 7v14"/></>,
    soil:<><path d="M4 11h16M3 16h18M5 21h14M12 10V5m0 3c-5 0-6-5-6-5s6 0 6 5Zm0 0c5 0 6-5 6-5s-6 0-6 5Z"/></>,
    passport:<><rect x="5" y="2" width="14" height="20" rx="2"/><circle cx="12" cy="10" r="4"/><path d="M8 17h8m-4-11v8M8 10h8"/></>,
    sources:<><path d="M12 5C6 1 3 4 3 4v15s3-3 9 1c6-4 9-1 9-1V4s-3-3-9 1Zm0 0v15"/></>,
    copilot:<><path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z"/></>,
    layers:<><path d="m2 8 10-5 10 5-10 5Zm0 5 10 5 10-5M2 18l10 5 10-5"/></>,
    reset:<><path d="M4 9a8 8 0 1 1 1 9M4 3v6h6"/></>,
    arrow:<path d="M4 12h16m-6-6 6 6-6 6"/>,
    cross:<path d="m6 6 12 12M6 18 18 6"/>,
    pin:<><path d="M19 9c0 6-7 13-7 13S5 15 5 9a7 7 0 1 1 14 0Z"/><circle cx="12" cy="9" r="2"/></>,
    download:<><path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/></>,
    sun:<><circle cx="12" cy="12" r="4"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/></>,
    water:<path d="M12 2S5 10 5 15a7 7 0 0 0 14 0c0-5-7-13-7-13Z"/>,
  };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{paths[name]??paths.atlas}</svg>;
}
export function Field({label,children,note}:{label:string;children:ReactNode;note?:string}) {return <label className="a-field"><span>{label}</span>{children}{note&&<small>{note}</small>}</label>;}
export function ErrorState({error,t,retry}:{error?:string;t:Translator;retry?:()=>void}) {return <div role="alert" className="a-error"><p>{t('networkError')}</p>{error&&<details><summary>{t('details')}</summary><p>{error}</p></details>}{retry&&<button className="a-button" onClick={retry}>{t('retry')}</button>}</div>;}
export function Pending({t}:{t:Translator}) {return <div className="a-pending" role="status"><span/>{t('running')}</div>;}
export function EmptyField({t,onField}:{t:Translator;onField:()=>void}) {return <div className="a-empty"><Glyph name="farm" size={52}/><h2>{t('noField')}</h2><p>{t('noFieldNote')}</p><button className="a-button primary" onClick={onField}>{t('selectFarm')}</button></div>;}
export function Metric({label,value,unit,note}:{label:string;value:ReactNode;unit?:string;note?:string}) {return <div className="a-metric"><span>{label}</span><strong>{value}<small>{unit}</small></strong>{note&&<p>{note}</p>}</div>;}
export function useFormat(language:Language,units:UnitSystem) {
  const number=(n:number|undefined|null,digits=1)=>typeof n==='number'&&Number.isFinite(n)?new Intl.NumberFormat(locales[language],{maximumFractionDigits:digits}).format(n):'—';
  return {number,depth:(n?:number|null)=>n==null?'—':`${number(convertDepth(n,units),units==='us'?2:1)} ${units==='us'?'in':'mm'}`,area:(ha:number)=>`${number(convertArea(ha,units),2)} ${units==='us'?'ac':'ha'}`,volume:(m3?:number|null)=>m3==null?'—':`${number(convertVolume(m3,units),0)} ${units==='us'?'gal':'m³'}`,date:(s:string)=>new Intl.DateTimeFormat(locales[language],{dateStyle:'medium',timeZone:'UTC'}).format(new Date(s))};
}

export function FieldOutline({boundary}:{boundary:LonLat[]}) {
  const minX=Math.min(...boundary.map(p=>p[0])),maxX=Math.max(...boundary.map(p=>p[0]));
  const minY=Math.min(...boundary.map(p=>p[1])),maxY=Math.max(...boundary.map(p=>p[1]));
  const cos=Math.cos((minY+maxY)/2*Math.PI/180),scale=190/Math.max((maxX-minX)*cos,maxY-minY,1e-7);
  const points=boundary.map(p=>`${130+(p[0]-(minX+maxX)/2)*cos*scale},${120-(p[1]-(minY+maxY)/2)*scale}`).join(' ');
  return <svg className="field-outline" viewBox="0 0 260 240" aria-label="WGS84 field boundary"><defs><pattern id="field-hatch" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(30)"><path d="M0 0V9" stroke="#367e85" strokeOpacity=".3"/></pattern></defs><path d="M130 10v18m-8-8h16" stroke="#a08048"/><text x="130" y="9" textAnchor="middle" fill="#637174" fontSize="8">N</text><polygon points={points} fill="url(#field-hatch)" stroke="#367e85" strokeWidth="2"/>{points.split(' ').map((p,i)=><circle key={i} cx={p.split(',')[0]} cy={p.split(',')[1]} r="3" fill="#173e50"/>)}</svg>;
}

// Every point comes from a returned series. Table exposes precise values to keyboard/AT users.
export function LineChart({series,labels,t,format,caption}:{series:{name:string;values:number[];color:string}[];labels:string[];t:Translator;format:(n:number)=>string;caption:string}) {
  const [hover,setHover]=useState<number|null>(null);
  const finite=series.flatMap(s=>s.values).filter(Number.isFinite),max=Math.max(1,...finite),min=Math.min(0,...finite),span=max-min;
  const point=(value:number,i:number)=>`${46+i/Math.max(1,labels.length-1)*610},${190-(value-min)/span*160}`;
  return <figure className="a-chart"><figcaption>{caption}</figcaption><svg viewBox="0 0 680 225" role="img" aria-label={caption} onPointerMove={e=>{const r=e.currentTarget.getBoundingClientRect();setHover(Math.max(0,Math.min(labels.length-1,Math.round(((e.clientX-r.left)/r.width*680-46)/610*(labels.length-1)))));}} onPointerLeave={()=>setHover(null)}>
    {[0,.5,1].map(f=><g key={f}><path d={`M46 ${190-f*160}H656`} stroke="#173e50" strokeOpacity=".13" strokeDasharray="3 5"/><text x="37" y={194-f*160} textAnchor="end" fontSize="11" fill="#637174">{format(min+f*span)}</text></g>)}
    {series.map(s=><polyline key={s.name} points={s.values.map(point).join(' ')} fill="none" stroke={s.color} strokeWidth="2.3" strokeLinejoin="round"/>)}
    {labels.length>0&&<><text x="46" y="215" fontSize="11" fill="#637174">{labels[0]}</text><text x="656" y="215" textAnchor="end" fontSize="11" fill="#637174">{labels.at(-1)}</text></>}
    {hover!==null&&<line x1={46+hover/Math.max(1,labels.length-1)*610} x2={46+hover/Math.max(1,labels.length-1)*610} y1="20" y2="190" stroke="#a08048"/>}
  </svg><div className="chart-legend">{series.map(s=><span key={s.name}><i style={{background:s.color}}/>{s.name}{hover!==null?` · ${format(s.values[hover])}`:''}</span>)}{hover!==null&&<span>{labels[hover]}</span>}</div>
  <details><summary>{t('table')}</summary><div className="table-scroll"><table><thead><tr><th>{t('date')}</th>{series.map(s=><th key={s.name}>{s.name}</th>)}</tr></thead><tbody>{labels.map((l,i)=><tr key={i}><td>{l}</td>{series.map(s=><td key={s.name}>{format(s.values[i])}</td>)}</tr>)}</tbody></table></div></details></figure>;
}
