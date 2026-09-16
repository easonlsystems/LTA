// Live provider canary. This never touches Link2AI accounts, quota, billing, DB state, or ASR.
// Stable public APIs/documents are release-gating; fragile social-video samples are observed
// and reported so platform drift is visible without making CI depend on someone else's post.
process.env.NODE_ENV='test';
process.env.DATABASE_URL='postgres://127.0.0.1:1/link2ai';
process.env.PUBLIC_BASE_URL='https://link2ai.example';
process.env.PUBLIC_BRAND_NAME='Link2AI';
process.env.APP_SECRET='01234567890123456789012345678901';
process.env.EXTRACTION_TIMEOUT_MS='30000';
process.env.AUDIO_EXTRACTION_TIMEOUT_MS='30000';

const {parseMediaUrl}=await import('../dist/src/media/url.js');
const {extractTextLink}=await import('../dist/src/content/linkText.js');
const {ResolverOrchestrator}=await import('../dist/src/resolvers/orchestrator.js');

const results=[];
async function probe(name,mode,fn){
  const started=Date.now();
  try{
    const value=await fn();
    results.push({name,mode,status:'PASS',ms:Date.now()-started,detail:value});
  }catch(error){
    results.push({name,mode,status:'FAIL',ms:Date.now()-started,detail:`${error?.code??error?.name??'Error'}: ${error?.message??String(error)}`});
  }
}
const textProbe=async url=>{
  const result=await extractTextLink(parseMediaUrl(url));
  if(!result.text||result.text.length<10)throw new Error('empty extracted text');
  return `${result.platform} · ${result.text.length} chars`;
};

await probe('Web page','gate',()=>textProbe('https://example.com/'));
await probe('GitHub Issue','gate',()=>textProbe('https://github.com/nodejs/node/issues/64850'));
await probe('Hacker News','gate',()=>textProbe('https://news.ycombinator.com/item?id=8863'));
await probe('Bluesky','gate',()=>textProbe('https://bsky.app/profile/bsky.app/post/3mnzpiackwk25'));
await probe('PDF','gate',()=>textProbe('https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf'));
await probe('X oEmbed','observe',()=>textProbe('https://x.com/githubstatus/status/2039764648241598521'));

const resolver=new ResolverOrchestrator();
await probe('YouTube metadata','observe',async()=>{
  const m=await resolver.metadata(parseMediaUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'));
  if(!m.canonicalMediaId)throw new Error('missing canonical id');
  return `${m.resolver??'unknown'} · ${m.durationSeconds||0}s`;
});
await probe('TikTok metadata','observe',async()=>{
  const m=await resolver.metadata(parseMediaUrl('https://www.tiktok.com/@scout2015/video/6718335390845095173'));
  if(!m.canonicalMediaId)throw new Error('missing canonical id');
  return `${m.resolver??'unknown'} · ${m.durationSeconds||0}s`;
});

// Reddit is intentionally expected to fail cleanly unless approved OAuth credentials
// are supplied to this process. That is a policy/readiness check, not an extraction bypass.
await probe('Reddit readiness','gate',async()=>{
  try{
    await textProbe('https://www.reddit.com/comments/1w8skpx/');
    if(!process.env.REDDIT_CLIENT_ID)throw new Error('Reddit unexpectedly succeeded without approved OAuth configuration');
    return 'approved OAuth configured';
  }catch(error){
    if(!process.env.REDDIT_CLIENT_ID&&error?.code==='PLATFORM_BLOCKED'&&error?.retryable===false)return 'clean PLATFORM_BLOCKED · approved OAuth not configured';
    throw error;
  }
});

for(const r of results)console.log(`${r.status.padEnd(4)}  ${r.mode.padEnd(7)}  ${r.name.padEnd(18)} ${String(r.ms).padStart(5)}ms  ${r.detail}`);
const failedGate=results.filter(r=>r.mode==='gate'&&r.status==='FAIL');
const failedObserved=results.filter(r=>r.mode==='observe'&&r.status==='FAIL');
console.log(`provider audit: ${results.length-failedGate.length-failedObserved.length} pass, ${failedGate.length} gating fail, ${failedObserved.length} observed platform fail`);
if(failedGate.length)process.exitCode=1;
