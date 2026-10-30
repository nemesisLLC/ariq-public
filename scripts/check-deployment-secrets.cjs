const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const values=[];
if(fs.existsSync('.env.local'))for(const line of fs.readFileSync('.env.local','utf8').split(/\r?\n/)){
  if(!/^[A-Z_]+=/.test(line))continue;
  let value=line.slice(line.indexOf('=')+1).trim();
  if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);
  if(value.length>=12)values.push(value);
}
if(fs.existsSync('.env.access-test.json'))values.push(JSON.parse(fs.readFileSync('.env.access-test.json','utf8')).client_secret);
const files=new Set(execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean));
for(const root of ['dist/client','dist/server','docs/deployment-review']){
  if(!fs.existsSync(root))continue;
  for(const name of fs.readdirSync(root,{recursive:true})){
    const file=path.join(root,name);
    if(fs.statSync(file).isFile()&&!file.endsWith('.log')&&!file.endsWith('.dev.vars'))files.add(file);
  }
}
const matches=[];
for(const file of files){if(!fs.existsSync(file))continue;const data=fs.readFileSync(file);if(values.some(v=>v&&data.includes(Buffer.from(v))))matches.push(file);}
const result={checkedFiles:files.size,knownSecretValuesChecked:values.length,matches,
  clientSecretFiles:[...files].filter(f=>f.startsWith('dist/client')&&/\.env|\.dev\.vars/.test(f)),
  localBindingsCopiedIntoBuild:fs.existsSync('dist/server/.dev.vars')};
fs.writeFileSync('docs/deployment-review/secret-check.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
if(matches.length||result.clientSecretFiles.length||result.localBindingsCopiedIntoBuild)process.exitCode=1;
