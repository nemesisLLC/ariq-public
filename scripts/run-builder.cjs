const {spawn,execFileSync}=require('node:child_process');
const fs=require('node:fs');
const [binary,promptPath,maxMinutes,maxTools,...args]=process.argv.slice(2);
const child=spawn(binary,args,{stdio:['pipe','pipe','pipe'],windowsHide:true});
let stopping=false,tools=0,buffer='';
function stop(reason){
  if(stopping)return;stopping=true;
  process.stderr.write(`Builder stopped: ${reason}\n`);
  try{if(process.platform==='win32')execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else child.kill('SIGTERM');}catch{}
}
const deadline=setTimeout(()=>stop('runtime limit reached'),Number(maxMinutes)*60000);
let idle=setTimeout(()=>stop('no progress for 180 seconds'),180000);
function progress(){clearTimeout(idle);idle=setTimeout(()=>stop('no progress for 180 seconds'),180000);}
child.stdout.on('data',data=>{
  progress();process.stdout.write(data);buffer+=data;
  let cut;
  while((cut=buffer.indexOf('\n'))>=0){
    const line=buffer.slice(0,cut);buffer=buffer.slice(cut+1);
    try{const event=JSON.parse(line);if(event.type==='item.started'&&['command_execution','file_change','mcp_tool_call'].includes(event.item?.type)){tools++;if(tools>Number(maxTools))stop('tool-call limit reached');}}catch{}
  }
});
child.stderr.on('data',data=>{progress();process.stderr.write(data);});
child.on('error',error=>{clearTimeout(deadline);clearTimeout(idle);process.stderr.write(error.message+'\n');process.exitCode=1;});
child.on('close',code=>{clearTimeout(deadline);clearTimeout(idle);process.exitCode=stopping?2:(code??1);});
process.on('SIGINT',()=>stop('interrupted'));
child.stdin.end(fs.readFileSync(promptPath,'utf8'));
