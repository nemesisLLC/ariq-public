import type {Language} from '../../lib/i18n-labels';
import {local} from './product';
export default function RootZone({rain,crop,depletion,capacity,language}:{rain:number|null;crop:number|null;depletion?:number;capacity?:number;language:Language}){
 const l=local(language),n=(v:number|null)=>v===null?"—":new Intl.NumberFormat(language,{maximumFractionDigits:1}).format(v);
 const wet=capacity&&depletion!==undefined?Math.max(0,Math.min(1,1-depletion/capacity)):null;
 return <figure className="root-zone"><svg viewBox="0 0 420 240" role="img" aria-label={l('Illustrative root-zone water balance','Ildiz zonasidagi suv balansi sxemasi','Иллюстрация водного баланса корневой зоны')}>
  <path d="M24 83H396V210H24Z" fill="#d5c4a6"/>{wet!==null&&<rect className="root-zone-water" x="24" y="83" width="372" height="127" style={{transform:`scaleY(${wet})`}} fill="#80b9bd" opacity=".65"/>}
  <path d="M24 83H396" stroke="#70896c" strokeWidth="5"/>
  {[105,210,315].map(x=><g key={x} stroke="#695d44" fill="none"><path d={`M${x} 53v112m0-44-22 24m22-6 20 20m-20-58-13 14`}/><path d={`M${x} 53q-25-26-29-11 3 13 29 11 26-24 27-10-3 12-27 10`} fill="#70896c" stroke="none"/></g>)}
  <path d="M58 20v36m-7-9 7 9 7-9M363 56V20m-7 9 7-9 7 9" stroke="#177e91" strokeWidth="2" fill="none"/>
  <text x="78" y="26">{n(rain)} mm</text><text x="258" y="26">{n(crop)} mm</text>
  <text x="36" y="232">{wet===null?l('Stored water unknown','Saqlangan suv noma’lum','Запас воды неизвестен'):l('Modelled water balance','Modellashtirilgan suv balansi','Модельный водный баланс')}</text>
 </svg><figcaption>{l('Rain enters; the crop uses water. This diagram explains model outputs, not measured soil layers or physical flow.','Yomg‘ir kiradi; ekin suv sarflaydi. Sxema model natijalarini tushuntiradi, dala o‘lchovi emas.','Осадки поступают, культура расходует воду. Схема поясняет модель, а не измеренные слои или физический поток.')}</figcaption></figure>;
}
