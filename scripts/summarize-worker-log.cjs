const fs = require('node:fs');
const label = process.env.ARIQ_RUNTIME_LABEL || 'deployed';
const text = fs.readFileSync(process.env.ARIQ_RUNTIME_LOG || 'docs/deployment-review/live-tail.log','utf8');
let depth=0,start=-1,quoted=false,escaped=false;
const events=[];
for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
  if(c==='"'){quoted=true;continue;}
  if(c==='{'){if(depth++===0)start=i;}
  if(c==='}'&&--depth===0&&start>=0){
    try{const e=JSON.parse(text.slice(start,i+1));const r=e.event?.request;
      events.push({timestamp:e.eventTimestamp,version:e.scriptVersion?.id,outcome:e.outcome,cpuMs:e.cpuTime,wallMs:e.wallTime,
        method:r?.method,path:r?new URL(r.url).pathname:undefined,query:r?new URL(r.url).search:undefined,status:e.event?.response?.status,
        cron:e.event?.cron,scheduledTime:e.event?.scheduledTime,
        exceptions:e.exceptions?.map(x=>({name:x.name,message:x.message}))});
    }catch{}start=-1;
  }
}
fs.writeFileSync(`docs/deployment-review/${label}-runtime.json`,JSON.stringify(events,null,2));
const cpu=events.map(e=>e.cpuMs).filter(Number.isFinite).sort((a,b)=>a-b);
console.log(JSON.stringify({requests:events.length,errors:events.filter(e=>e.outcome!=='ok'),
  cpuP50:cpu[Math.floor(cpu.length*.5)],cpuP95:cpu[Math.floor(cpu.length*.95)],maxCpu:cpu.at(-1),
  scheduled:events.filter(e=>e.cron)},null,2));
