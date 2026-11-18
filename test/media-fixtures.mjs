import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import ffmpeg from '@ffmpeg-installer/ffmpeg';
import ffprobe from '@ffprobe-installer/ffprobe';

process.env.NODE_ENV='test';
process.env.DATABASE_URL='postgres://127.0.0.1:1/link2ai';
process.env.PUBLIC_BASE_URL='https://test.example';
process.env.APP_SECRET='01234567890123456789012345678901';
process.env.GROQ_API_KEY='fixture-key';
process.env.OPENAI_API_KEY='fixture-key';
process.env.FFMPEG_BIN=ffmpeg.path;
process.env.FFPROBE_BIN=ffprobe.path;
process.env.PATH=`${path.dirname(ffprobe.path)}${path.delimiter}${process.env.PATH??''}`;
const {validateAudioStream,normalizeAudioForAsr,probeMediaDurationSeconds}=await import('../dist/src/media/audio.js');
const {runProviderChain}=await import('../dist/src/resolvers/providerChain.js');
const {timelineCoverageVerified}=await import('../dist/src/media/timeline.js');
const {videoTranscriptQuality}=await import('../dist/src/worker/processor.js');
const {transcribeAudio}=await import('../dist/src/transcription/router.js');
const {pool}=await import('../dist/src/db/pool.js');
const {parseMediaUrl}=await import('../dist/src/media/url.js');
const {publicPayload}=await import('../dist/src/api/publicApi.js');
const {chunkResult}=await import('../dist/src/mcp/server.js');
const dir=await mkdtemp(path.join(tmpdir(),'lta-media-fixtures-'));
async function run(args){
  const result=await new Promise((resolve,reject)=>{
    const child=spawn(ffmpeg.path,['-hide_banner','-loglevel','error','-y',...args]);
    let stderr='';child.stderr.on('data',x=>stderr+=x);
    child.on('error',reject);child.on('close',code=>resolve({code,stderr}));
  });
  assert.equal(result.code,0,result.stderr);
}
try{
  const audio=path.join(dir,'audio.wav');
  const video=path.join(dir,'video.mp4');
  const both=path.join(dir,'both.mp4');
  const silence=path.join(dir,'silence.wav');
  const corrupt=path.join(dir,'corrupt.mp4');
  const unsupported=path.join(dir,'unsupported.wav');
  await run(['-f','lavfi','-i','sine=frequency=440:duration=2','-c:a','pcm_s16le',audio]);
  await run(['-f','lavfi','-i','color=c=black:s=160x120:d=2','-an','-c:v','mpeg4',video]);
  await run(['-i',video,'-i',audio,'-c:v','copy','-c:a','aac','-shortest',both]);
  await run(['-f','lavfi','-i','anullsrc=r=16000:cl=mono','-t','2','-c:a','pcm_s16le',silence]);
  await writeFile(corrupt,Buffer.from('not a media file'));
  const unsupportedBytes=await readFile(audio);
  unsupportedBytes.writeUInt16LE(0xffff,20);
  await writeFile(unsupported,unsupportedBytes);
  for(const source of [audio,both,silence]){
    await validateAudioStream(source);
    const out=await normalizeAudioForAsr(source,dir);
    assert.ok((await stat(out)).size>0);
    assert.ok(await probeMediaDurationSeconds(out)>=2);
  }
  assert.equal(await probeMediaDurationSeconds(video),2,'container duration can exist without audio');
  await assert.rejects(validateAudioStream(video),e=>e.details?.cause_code==='no_audio_stream'&&e.retryable===false);
  await assert.rejects(validateAudioStream(corrupt),e=>e.details?.cause_code==='audio_stream_probe_failed');
  await assert.rejects(validateAudioStream(unsupported),e=>e.details?.cause_code==='unsupported_audio_codec'&&!e.retryable);
  const outcomes=[];
  const prepared=await runProviderChain({platform:'instagram',operation:'audio',telemetry:async e=>outcomes.push(e),attempts:[
    {name:'primary',run:async()=>{await validateAudioStream(video);return video;}},
    {name:'external',run:async()=>{await validateAudioStream(audio);return audio;}}
  ]});
  assert.equal(prepared,audio);
  assert.deepEqual(outcomes.map(x=>x.outcome),['failed','success']);
  for(const [url,platform] of [
    ['https://www.instagram.com/reel/Ddx6Q_MJNyg/','instagram'],
    ['https://www.youtube.com/watch?v=M7lc1UVf-VE','youtube'],
    ['https://www.youtube.com/shorts/M7lc1UVf-VE','youtube'],
    ['https://www.tiktok.com/@creator/video/1234567890123456789','tiktok'],
    ['https://x.com/creator/status/1234567890123456789','x']
  ])assert.equal(parseMediaUrl(url).platform,platform);
  const failed=[];
  await assert.rejects(runProviderChain({platform:'youtube',operation:'audio',telemetry:async e=>failed.push(e),attempts:[
    {name:'primary',run:async()=>{await validateAudioStream(video);return video;}},
    {name:'external',run:async()=>{await validateAudioStream(corrupt);return corrupt;}}
  ]}),e=>e.details?.cause_code==='audio_stream_probe_failed'&&!e.retryable);
  assert.deepEqual(failed.map(x=>x.outcome),['failed','failed']);
  assert.equal(timelineCoverageVerified(27,[]),false);
  assert.equal(timelineCoverageVerified(27,[{start:0,end:27}]),true);
  assert.equal(timelineCoverageVerified(100,[{start:0,end:10},{start:80,end:100}]),false);
  const unverifiedRest=publicPayload({status:'completed',job_id:'fixture',platform:'instagram',duration_seconds:27,transcript:'Hello world',transcript_source:'asr',segments:[],usage_units:1});
  assert.equal(unverifiedRest.source_completeness,'unverified');
  assert.equal(unverifiedRest.timeline_coverage_verified,false);
  assert.equal(unverifiedRest.content_complete,false);
  assert.equal(unverifiedRest.content_scope,'spoken_and_caption_text');
  const unverifiedMcp=chunkResult({status:'completed',job_id:'fixture',platform:'instagram',duration_seconds:27,transcript:'Hello world',transcript_source:'asr',segments:[],usage_units:1});
  assert.equal(unverifiedMcp.source_completeness,'unverified');
  assert.equal(unverifiedMcp.content_complete,false);
  assert.match(unverifiedMcp.limitation_notice,/visual frame passthrough is not included/);
  assert.equal(videoTranscriptQuality('[Instrumental music]',27).ok,false);
  assert.equal(videoTranscriptQuality('Hello world',27).ok,true);
  const originalFetch=globalThis.fetch;
  try{
    const asrProviders=[];
    globalThis.fetch=async url=>{
      const provider=String(url).includes('groq.com')?'groq':'openai';
      asrProviders.push(provider);
      return Response.json({text:provider==='groq'?'[Instrumental music]':'Hello world',segments:[{start:0,end:2,text:'Hello world'}]});
    };
    const asr=await transcribeAudio(audio,'auto',result=>{
      if(!videoTranscriptQuality(result.transcript,2).ok)throw new Error('marker only');
    });
    assert.equal(asr.provider,'openai');
    assert.deepEqual(asrProviders,['groq','openai']);
    globalThis.fetch=async()=>new Response('unavailable',{status:503});
    await assert.rejects(transcribeAudio(audio),e=>e.code==='TRANSCRIPTION_FAILED'&&e.retryable);
  }finally{globalThis.fetch=originalFetch;}
}finally{await rm(dir,{recursive:true,force:true});await pool.end();}
console.log('media fixture tests PASS');
