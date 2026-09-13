import os from 'node:os';
import http from 'node:http';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import { claimNextJob, deferJob, recoverStaleJobs } from './jobs.js';
import { processJob } from './processor.js';
import { readinessIssues } from '../config/readiness.js';
import { assertWorkerRuntime } from './preflight.js';
import { cleanupStaleTempDirs } from './tempCleanup.js';

const workerId=`${os.hostname()}:${process.pid}`;
let stopping=false;
let activeJobs=0;
let inflightClaims=0;
let lastJobAt:string|null=null;

const health=http.createServer(async(req,res)=>{
  if(req.url!=='/healthz'&&req.url!=='/readyz'){res.statusCode=404;res.end('not found');return;}
  res.setHeader('content-type','application/json');
  if(req.url==='/healthz'){
    res.statusCode=200;
    res.end(JSON.stringify({ok:true,service:'link2ai-worker',worker_id:workerId,active_jobs:activeJobs,worker_concurrency:env().WORKER_CONCURRENCY,last_job_at:lastJobAt}));
    return;
  }
  try{
    await pool.query('SELECT 1');
    const issues=readinessIssues('worker');
    res.statusCode=issues.length?503:200;res.end(JSON.stringify({ready:issues.length===0,issues}));
  }catch{res.statusCode=503;res.end(JSON.stringify({ok:false}));}
});
health.listen(env().PORT,'0.0.0.0');

const sleepers=new Map<ReturnType<typeof setTimeout>,()=>void>();
async function sleep(ms:number){
  if(stopping)return;
  await new Promise<void>(resolve=>{
    const timer=setTimeout(()=>{sleepers.delete(timer);resolve();},ms);
    sleepers.set(timer,resolve);
  });
}
function wakeSleepers(){
  for(const [timer,resolve] of sleepers){clearTimeout(timer);resolve();}
  sleepers.clear();
}
async function slot(slotId:number){
  while(!stopping){
    inflightClaims++;
    let job;
    try{job=await claimNextJob(`${workerId}:${slotId}`);}
    finally{inflightClaims--;}
    if(!job){await sleep(env().WORKER_POLL_MS);continue;}
    activeJobs++;
    try{
      if(stopping){await deferJob(job.id,0);continue;}
      await processJob(job);lastJobAt=new Date().toISOString();
    }finally{activeJobs--;}
  }
}
async function maintenance(){
  while(!stopping){
    await sleep(60_000);
    if(stopping)break;
    await recoverStaleJobs().catch(err=>console.error(JSON.stringify({ts:new Date().toISOString(),event:'maintenance_error',error_message:err instanceof Error?err.message:String(err)})));
    await cleanupStaleTempDirs().catch(()=>{});
  }
}
async function main(){
  await assertWorkerRuntime();
  await cleanupStaleTempDirs();
  await recoverStaleJobs();
  console.log(`[worker] Link2AI worker ${workerId} started with ${env().WORKER_CONCURRENCY} slots`);
  await Promise.all([...Array.from({length:env().WORKER_CONCURRENCY},(_,i)=>slot(i+1)),maintenance()]);
}
async function shutdown(){
  if(stopping)return;stopping=true;
  wakeSleepers();
  await new Promise<void>(resolve=>health.close(()=>resolve()));
  // Give active jobs a short chance to finish. This wait must still yield after
  // `stopping=true`; the polling sleep above intentionally wakes immediately on stop.
  const deadline=Date.now()+10_000;
  while((activeJobs>0||inflightClaims>0)&&Date.now()<deadline){
    await new Promise<void>(resolve=>setTimeout(resolve,200));
  }
  // Do not tear the DB pool out from underneath a still-running extraction. Railway's
  // termination grace will eventually kill it, and stale-job recovery will requeue it.
  if(activeJobs===0&&inflightClaims===0)await pool.end();
}
process.on('SIGTERM',()=>void shutdown());
process.on('SIGINT',()=>void shutdown());
main().catch(async err=>{console.error(err);stopping=true;health.close();await pool.end();process.exit(1);});
