import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
const image='docker.io/pgsty/silo@sha256:b616a0cf8cb281e7e6bb3c9b1fb53875b4016a2878223925541c18f82d6c5ca3';
const name='shipit-attachments-'+randomUUID(),owner=randomUUID(),password=randomBytes(32).toString('hex');
let container,interrupted=false;const children=new Set();
const stop=()=>{interrupted=true;for(const child of children)child.kill('SIGTERM');};process.once('SIGINT',stop);process.once('SIGTERM',stop);
function run(command,args,{env=process.env,inherit=false,timeout=120000}={}){
 return new Promise((resolve,reject)=>{const child=spawn(command,args,{env,stdio:inherit?'inherit':['ignore','pipe','pipe']});children.add(child);let output='';
  child.stdout?.on('data',chunk=>{if(output.length<65536)output+=chunk.toString();});child.stderr?.resume();const timer=setTimeout(()=>child.kill('SIGKILL'),timeout);
  child.once('error',()=>{children.delete(child);clearTimeout(timer);reject(new Error('ATTACHMENT_CONTRACT_PROCESS_FAILED'));});child.once('close',status=>{children.delete(child);clearTimeout(timer);resolve({status,output});});});
}
try{
 const c=await run('docker',['create','--name',name,'--label',`com.shippingco.test-owner=${owner}`,'--publish','127.0.0.1::9000','--env','MINIO_ROOT_USER=shipit_test','--env','MINIO_ROOT_PASSWORD',image,'server','/data'],{env:{...process.env,MINIO_ROOT_PASSWORD:password}});
 if(c.status!==0||!/^[a-f0-9]{64}\s*$/.test(c.output))throw new Error('ATTACHMENT_CONTRACT_CREATE_FAILED');container=c.output.trim();
 if((await run('docker',['start',container])).status!==0)throw new Error('ATTACHMENT_CONTRACT_START_FAILED');
 const p=await run('docker',['port',container,'9000/tcp']),port=p.output.trim().match(/^127\.0\.0\.1:(\d+)$/)?.[1];if(!port)throw new Error('ATTACHMENT_CONTRACT_PORT_FAILED');
 const endpoint=`http://127.0.0.1:${port}`,deadline=Date.now()+30000;let healthy=false;
 while(Date.now()<deadline&&!interrupted){try{if((await fetch(endpoint+'/minio/health/live',{signal:AbortSignal.timeout(1000)})).ok){healthy=true;break;}}catch{/* Bounded health retry; failure at deadline is fatal. */}await delay(200);}
 if(!healthy||interrupted)throw new Error('ATTACHMENT_CONTRACT_UNAVAILABLE');
 const pnpm=process.env.npm_execpath;if(!pnpm)throw new Error('ATTACHMENT_CONTRACT_RUN_THROUGH_PNPM');
 const result=await run(process.execPath,[pnpm,'--filter','@shippingco/api','exec','vitest','run','--config','vitest.attachments.config.ts'],{inherit:true,env:{...process.env,ATTACHMENT_TEST_ENDPOINT:endpoint,ATTACHMENT_TEST_ACCESS_KEY:'shipit_test',ATTACHMENT_TEST_SECRET:password},timeout:90000});
 if(result.status!==0)throw new Error('ATTACHMENT_CONTRACT_TEST_FAILED');
 console.log('S3-compatible private object contract passed.');
}catch(error){console.error(error instanceof Error&&error.message.startsWith('ATTACHMENT_CONTRACT_')?error.message:'ATTACHMENT_CONTRACT_FAILED');process.exitCode=1;}
finally{
 if(!container){
  const inspect=await run('docker',['inspect','--format','{{.Id}} {{index .Config.Labels "com.shippingco.test-owner"}}',name]);
  const [id,label]=inspect.output.trim().split(' ');
  if(inspect.status===0&&label===owner&&/^[a-f0-9]{64}$/.test(id))container=id;
  else {
   const remaining=await run('docker',['ps','--all','--quiet','--filter',`name=^/${name}$`]);
   if(remaining.status!==0||remaining.output.trim()){console.error('ATTACHMENT_CONTRACT_CLEANUP_FAILED');process.exitCode=1;}
  }
 }
 if(container){if((await run('docker',['rm','--force','--volumes',container])).status!==0){console.error('ATTACHMENT_CONTRACT_CLEANUP_FAILED');process.exitCode=1;}else console.log('Disposable object-store container removed.');}
 if(interrupted)process.exitCode=130;
}
