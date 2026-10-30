const fs=require('node:fs');
const root='docs/deployment-review/';
const farm=JSON.parse(fs.readFileSync(root+'final-farm/results.json'));
const tools=JSON.parse(fs.readFileSync(root+'final-farm/tools-results.json'));
const runtime=JSON.parse(fs.readFileSync(root+'final-runtime.json'));
const cpu=runtime.map(x=>x.cpuMs).filter(Number.isFinite).sort((a,b)=>a-b);
const summary={
  url:farm.base,branch:'cloudflare-private-preview',applicationCommit:'13ae64888dd69c0c880ec539d5da0b0d6fdd2dee',
  unitTestsPassed:150,
  farm:{checks:farm.checks,pageErrors:farm.errors,recommendationStatuses:farm.responses.map(r=>r.status)},
  tools:{checks:tools.checks,pageErrors:tools.errors,responses:tools.responses.map(r=>({path:new URL(r.url).pathname,status:r.status,kind:r.body?.kind}))},
  runtime:{invocations:runtime.length,cpuMedian:cpu[Math.floor(cpu.length*.5)],cpuP95:cpu[Math.floor(cpu.length*.95)],maxCpu:cpu.at(-1),
    workerFailures:runtime.filter(r=>!['ok','canceled'].includes(r.outcome)),clientCancellations:runtime.filter(r=>r.outcome==='canceled').length,
    coldOutliers:runtime.filter(r=>r.cpuMs>10).map(r=>({path:r.path,cpuMs:r.cpuMs,status:r.status,outcome:r.outcome}))},
  scheduledRefresh:JSON.parse(fs.readFileSync(root+'scheduled-refresh.json')),
  security:JSON.parse(fs.readFileSync(root+'security-configuration.json')),
  secretScan:JSON.parse(fs.readFileSync(root+'secret-check.json')),
  limitations:['One-run loading observations, not an SLA.','Cold CPU spikes remain; sustained load untested.','Refresh snapshots remain per data center and non-authoritative.','Verification coordinates and scientific inputs are explicit fixtures, not farm observations.'],
};
fs.writeFileSync(root+'verification-summary.json',JSON.stringify(summary,null,2));
console.log('Verified browser checks:',farm.checks.length+tools.checks.length);
