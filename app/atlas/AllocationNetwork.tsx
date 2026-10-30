import type {ScheduleInput} from '../../lib/irrigation/scheduler';
import type {Language} from '../../lib/i18n-labels';
import {local} from './product';
/** Layout only: all connectivity and capacities come from the supplied engine input. */
export default function AllocationNetwork({input,language}:{input:ScheduleInput;language:Language}){
 const l=local(language),network=input.network,depth=new Map<string,number>([[network.sourceId,0]]),queue=[network.sourceId];
 for(let i=0;i<queue.length;i++)for(const edge of network.edges.filter(e=>e.from===queue[i]))if(!depth.has(edge.to)){depth.set(edge.to,(depth.get(edge.from)??0)+1);queue.push(edge.to);}
 const max=Math.max(1,...depth.values()),positions=new Map(network.nodes.map((id,i)=>[id,{x:35+(depth.get(id)??max)*430/max,y:45+i*48}]));
 return <figure><svg className="allocation-network" viewBox={`0 0 560 ${70+network.nodes.length*48}`} role="img" aria-label={l('Supplied network, schematic','Kiritilgan tarmoq sxemasi','Схема заданной сети')}>
 {network.edges.map(e=>{const a=positions.get(e.from),b=positions.get(e.to);return a&&b?<g key={e.id}><path d={`M${a.x} ${a.y}L${b.x} ${b.y}`} stroke={e.closed?'#9a572f':'#177e91'} strokeWidth="2" strokeDasharray={e.closed?'4 4':undefined}/><title>{e.id}: {e.from} → {e.to}; {e.maxFlowM3PerHour} m³/h; {e.efficiency*100}%; {e.closed?'closed':'open'}</title></g>:null;})}
 {network.nodes.map(id=>{const p=positions.get(id)!;return <g key={id}><circle cx={p.x} cy={p.y} r="6" fill="#173f49"/><text x={p.x+10} y={p.y+4}>{id}</text></g>;})}
 </svg><figcaption className="field-note">{l('Explicit network connections; schematic distances only.','Aniq tarmoq ulanishlari; masofalar faqat sxema.','Явно заданные связи; расстояния схематические.')}</figcaption><details><summary>{l('Canal limits and connections','Kanal cheklovlari va ulanishlar','Ограничения и связи каналов')}</summary>{network.edges.map(e=><p key={e.id}>{e.id}: {e.from} → {e.to} · {e.maxFlowM3PerHour} m³/h · {e.efficiency*100}% {e.closed?l('closed','yopiq','закрыт'):''}</p>)}</details></figure>;
}
