export type Demand = {id:number;need:number;priority:number};
export function allocate(fields:Demand[],supply:number):Record<number,number> {
 if(!Number.isFinite(supply)||supply<0) throw new Error('Supply must be a non-negative number.');
 if(fields.some(f=>!Number.isFinite(f.need)||f.need<0||!Number.isFinite(f.priority)||f.priority<=0)||new Set(fields.map(f=>f.id)).size!==fields.length) throw new Error('Invalid field data.');
 const result:Record<number,number>=Object.fromEntries(fields.map(f=>[f.id,0]));
 let remaining=Math.min(supply,fields.reduce((n,f)=>n+f.need,0));
 let active=fields.filter(f=>f.need>0);
 while(remaining>0.000001&&active.length){
  const weight=active.reduce((n,f)=>n+f.need*f.priority,0);let used=0;
  for(const f of active){const amount=Math.min(f.need-result[f.id],remaining*(f.need*f.priority)/weight);result[f.id]+=amount;used+=amount;}
  remaining-=used;active=active.filter(f=>f.need-result[f.id]>0.000001);
 }
 return Object.fromEntries(Object.entries(result).map(([id,amount])=>[id,Math.floor(amount)]));
}
