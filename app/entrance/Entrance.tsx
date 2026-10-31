'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import './entrance.css';
const PortalScene=dynamic(()=>import('./PortalScene'),{ssr:false});
const Atlas=dynamic(()=>import('../atlas/AtlasExperience'),{ssr:false,loading:()=> <div className="registan-app-loading" role="status">Preparing ARIQ…</div>});
const words={
  en:{subtitle:'The Water of Uzbekistan',enter:'Enter ARIQ',skip:'Skip intro',replay:'Replay entrance',loading:'Preparing the entrance…',error:'The 3D entrance is unavailable. You can still enter ARIQ.',travel:'Entering ARIQ…',language:'Entrance language'},
  uz:{subtitle:'O‘zbekiston suvi',enter:'ARIQ’ga kirish',skip:'Kirishni o‘tkazib yuborish',replay:'Kirishni qayta ko‘rish',loading:'Kirish sahnasi tayyorlanmoqda…',error:'3D sahna mavjud emas. ARIQ’ga kirishingiz mumkin.',travel:'ARIQ ochilmoqda…',language:'Kirish tili'},
  ru:{subtitle:'Вода Узбекистана',enter:'Войти в ARIQ',skip:'Пропустить',replay:'Повторить вступление',loading:'Подготовка вступления…',error:'3D-сцена недоступна. Вы можете войти в ARIQ.',travel:'Вход в ARIQ…',language:'Язык вступления'},
};
export default function Entrance(){
  const [language,setLanguage]=useState<keyof typeof words>('en'),[stage,setStage]=useState<'initial'|'arrival'|'entering'|'app'>('initial');
  const [reviewClean,setReviewClean]=useState(false),[reviewLoading,setReviewLoading]=useState(false);
  const [ready,setReady]=useState(false),[failed,setFailed]=useState(false),[reduced,setReduced]=useState(false),[mobile,setMobile]=useState(false);
  const warmed=useRef(false),app=useRef<HTMLDivElement>(null),enterButton=useRef<HTMLButtonElement>(null);const t=words[language];
  const warm=useCallback(()=>{if(warmed.current)return;warmed.current=true;void import('../atlas/AtlasExperience').catch(()=>{});void import('../atlas/terrain').then(m=>m.loadReliefData(()=>{})).catch(()=>{});},[]);
  const done=useCallback(()=>{try{sessionStorage.setItem('ariq-entered','1');}catch{}setStage('app');warm();},[warm]);
  useEffect(()=>{if(process.env.NODE_ENV==='development'){setReviewClean(new URLSearchParams(location.search).has('reviewClean'));setReviewLoading(new URLSearchParams(location.search).has('reviewLoading'));}const media=matchMedia('(prefers-reduced-motion: reduce)');const change=()=>setReduced(media.matches);change();media.addEventListener('change',change);
    try{const l=sessionStorage.getItem('ariq-intro-language');if(l&&l in words)setLanguage(l as keyof typeof words);const review=process.env.NODE_ENV==='development'&&location.search.includes('review');setStage(!review&&sessionStorage.getItem('ariq-entered')?'app':'arrival');if(review&&location.search.includes('reviewReduced'))setReduced(true);}catch{setStage('arrival');}
    return()=>media.removeEventListener('change',change);},[]);
  useEffect(()=>{
    const media=matchMedia('(max-width: 760px), (hover: none) and (pointer: coarse)');
    const change=()=>{setMobile(media.matches);if(media.matches)setStage('app');};
    change();media.addEventListener('change',change);
    return()=>media.removeEventListener('change',change);
  },[]);
  useEffect(()=>{if(stage==='app')app.current?.focus();},[stage]);
  useEffect(()=>{if(ready||failed){const id=setTimeout(warm,120);return()=>clearTimeout(id);}},[ready,failed,warm]);
  const replay=()=>{setReady(false);setFailed(false);setStage('arrival');requestAnimationFrame(()=>enterButton.current?.focus());};
  if(stage==='initial')return <div className="registan-app-loading" role="status">Preparing ARIQ…</div>;
  if(stage==='app')return <div ref={app} tabIndex={-1} className="registan-app" aria-label="ARIQ application"><Atlas/>{!mobile&&<button className="registan-replay" onClick={replay}>{t.replay}</button>}</div>;
  return <main className={`registan-entrance ${reviewClean?'review-clean':''} ${ready?'is-ready':''} ${stage==='entering'?'is-entering':''}`} lang={language} aria-label="ARIQ entrance">
    <div className="registan-preview" aria-hidden="true"/>
    {!failed&&!reviewLoading&&<PortalScene entering={stage==='entering'} reduced={reduced} onReady={()=>setReady(true)} onDone={done} onError={()=>{setFailed(true);setReady(false);if(stage==='entering')done();}}/>}
    <div className="registan-vignette" aria-hidden="true"/>
    <header className="registan-top" inert={stage==='entering'}><div className="registan-brand"><h1 translate="no">ARIQ</h1><p>{t.subtitle}</p></div><div className="registan-languages" role="group" aria-label={t.language}>{(['en','uz','ru'] as const).map(l=><button key={l} lang={l} aria-label={{en:'English',uz:'O‘zbekcha',ru:'Русский'}[l]} aria-pressed={language===l} onClick={()=>{setLanguage(l);try{sessionStorage.setItem('ariq-intro-language',l);}catch{}}}>{l.toUpperCase()}</button>)}</div></header>
    <div className="registan-title" inert={stage==='entering'}><button ref={enterButton} className="registan-enter" onClick={()=>{if(!ready||failed||reduced)done();else setStage('entering');}} disabled={stage==='entering'}>{t.enter}<svg aria-hidden="true" viewBox="0 0 32 24"><path d="M2 12h26M20 4l8 8-8 8"/></svg></button></div>
    <footer className="registan-bottom"><span role="status">{failed?t.error:!ready?t.loading:stage==='entering'?t.travel:'Registan'}</span><button onClick={done}>{t.skip}</button></footer>
  </main>;
}
