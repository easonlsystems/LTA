from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, got {count}')
    return text.replace(old, new, 1)

# --- env: official Reddit OAuth configuration (optional, but required to expose Reddit) ---
p = Path('src/config/env.ts')
s = p.read_text(encoding='utf-8')
s = replace_once(
    s,
    "  GROQ_API_KEY: z.string().optional(),\n",
    "  GROQ_API_KEY: z.string().optional(),\n  REDDIT_CLIENT_ID: z.string().trim().min(1).optional(),\n  REDDIT_CLIENT_SECRET: z.string().trim().min(1).optional(),\n  REDDIT_USER_AGENT: z.string().trim().min(8).max(256).default('Link2AI/1.3 public-link-reader'),\n",
    'reddit env schema'
)
p.write_text(s, encoding='utf-8')

# --- Reddit: stop anonymous anti-bot bypass attempts; use approved OAuth Data API only ---
p = Path('src/content/linkText.ts')
s = p.read_text(encoding='utf-8')
s = replace_once(s, "import { Link2AIError } from '../util/errors.js';\n", "import { Link2AIError } from '../util/errors.js';\nimport { env } from '../config/env.js';\n", 'linkText env import')

old_share = re.compile(r"export async function resolveRedditSharePost\(input:ParsedMediaUrl\):Promise<ParsedMediaUrl>\{.*?\n\}\n\nfunction cleanText", re.S)
new_share = '''export async function resolveRedditSharePost(input:ParsedMediaUrl):Promise<ParsedMediaUrl>{
  if(input.platform!=='reddit'||!input.canonicalMediaId.startsWith('share_'))return input;
  // Opaque /s/ tokens are not Reddit post IDs and the approved Data API does not
  // provide a supported token-to-post lookup. Do not scrape/impersonate around that
  // boundary: ask for the canonical /comments/<post_id>/ URL instead.
  throw new Link2AIError(
    'UNSUPPORTED_URL',
    'This Reddit share URL is opaque. Open the post and use its canonical /comments/ URL.',
    422,false,{cause_code:'reddit_opaque_share_url'}
  );
}

function cleanText'''
s, n = old_share.subn(new_share, s, count=1)
if n != 1:
    raise SystemExit(f'reddit share resolver replacement: expected 1, got {n}')

reddit_block = re.compile(r"async function fetchRedditJsonViaBrowserFingerprint\(postId:string\):Promise<unknown>\{.*?\n\}\n\nasync function fetchRedditPost\(input:ParsedMediaUrl\):Promise<LinkTextPayload>\{.*?\n\}\n\nfunction collectGalleryCandidates", re.S)
new_reddit = r'''type RedditTokenCache={accessToken:string;expiresAt:number};
let redditTokenCache:RedditTokenCache|undefined;

export function redditOAuthConfigured():boolean{
  const e=env();
  return Boolean(e.REDDIT_CLIENT_ID?.trim()&&e.REDDIT_CLIENT_SECRET?.trim());
}

async function redditAccessToken(force=false):Promise<string>{
  const e=env();
  const clientId=e.REDDIT_CLIENT_ID?.trim();
  const clientSecret=e.REDDIT_CLIENT_SECRET?.trim();
  if(!clientId||!clientSecret){
    throw new Link2AIError(
      'PLATFORM_BLOCKED',
      'Reddit reads are temporarily unavailable while approved Reddit Data API access is being configured.',
      503,false,{cause_code:'reddit_oauth_not_configured',transport:'reddit_oauth'}
    );
  }
  if(!force&&redditTokenCache&&redditTokenCache.expiresAt>Date.now()+60_000)return redditTokenCache.accessToken;
  const auth=Buffer.from(`${clientId}:${clientSecret}`,'utf8').toString('base64');
  let response:Response;
  try{
    response=await fetch('https://www.reddit.com/api/v1/access_token',{
      method:'POST',
      headers:{'authorization':`Basic ${auth}`,'content-type':'application/x-www-form-urlencoded','user-agent':e.REDDIT_USER_AGENT},
      body:'grant_type=client_credentials',
      signal:AbortSignal.timeout(12_000)
    });
  }catch(error){
    throw new Link2AIError('EXTRACTION_FAILED','Reddit OAuth could not be reached.',502,true,{transport:'reddit_oauth',cause_code:error instanceof Error?error.name:'network_error'});
  }
  const body=(await response.text()).slice(0,64_000);
  if(!response.ok){
    const retryable=response.status===429||response.status>=500;
    throw new Link2AIError(
      response.status===429?'RATE_LIMITED':'PLATFORM_BLOCKED',
      retryable?'Reddit OAuth is temporarily unavailable.':'Reddit OAuth credentials were rejected or are not approved for this access.',
      response.status===429?429:503,retryable,{transport:'reddit_oauth',cause_code:`oauth_http_${response.status}`}
    );
  }
  let payload:any;
  try{payload=JSON.parse(body);}catch{throw new Link2AIError('EXTRACTION_FAILED','Reddit OAuth returned malformed JSON.',502,true,{transport:'reddit_oauth',cause_code:'oauth_invalid_json'});}
  const token=typeof payload?.access_token==='string'?payload.access_token:'';
  const expiresIn=Number(payload?.expires_in??3600);
  if(!token)throw new Link2AIError('PLATFORM_BLOCKED','Reddit OAuth did not issue an access token.',503,false,{transport:'reddit_oauth',cause_code:'oauth_missing_token'});
  redditTokenCache={accessToken:token,expiresAt:Date.now()+Math.max(60,Math.min(3600,Number.isFinite(expiresIn)?expiresIn:3600))*1000};
  return token;
}

async function redditOAuthJson(postId:string,retry401=true):Promise<unknown>{
  const token=await redditAccessToken(!retry401);
  const e=env();
  const endpoint=`https://oauth.reddit.com/comments/${encodeURIComponent(postId)}?raw_json=1&limit=${REDDIT_MAX_COMMENTS}&depth=${REDDIT_MAX_DEPTH}&sort=top`;
  let response:Response;
  try{
    response=await fetch(endpoint,{headers:{'authorization':`Bearer ${token}`,'accept':'application/json','user-agent':e.REDDIT_USER_AGENT},signal:AbortSignal.timeout(15_000)});
  }catch(error){
    throw new Link2AIError('EXTRACTION_FAILED','Reddit Data API could not be reached.',502,true,{transport:'reddit_oauth',cause_code:error instanceof Error?error.name:'network_error'});
  }
  if(response.status===401&&retry401){redditTokenCache=undefined;return await redditOAuthJson(postId,false);}
  if(response.status===404)throw new Link2AIError('MEDIA_NOT_FOUND','This Reddit post was not found or is no longer public.',404,false,{transport:'reddit_oauth',cause_code:'reddit_http_404'});
  if(response.status===403)throw new Link2AIError('PLATFORM_BLOCKED','Reddit did not permit this app to access the requested public post.',403,false,{transport:'reddit_oauth',cause_code:'reddit_http_403'});
  if(response.status===429)throw new Link2AIError('RATE_LIMITED','Reddit rate-limited this request. Try again later.',429,true,{transport:'reddit_oauth',cause_code:'reddit_http_429'});
  if(!response.ok)throw new Link2AIError('EXTRACTION_FAILED',`Reddit Data API returned HTTP ${response.status}.`,502,response.status>=500,{transport:'reddit_oauth',cause_code:`reddit_http_${response.status}`});
  const declared=Number(response.headers.get('content-length')??0);
  if(Number.isFinite(declared)&&declared>API_MAX_BYTES)throw new Link2AIError('EXTRACTION_FAILED','Reddit response exceeded the safe content limit.',502,false,{transport:'reddit_oauth',cause_code:'response_too_large'});
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length>API_MAX_BYTES)throw new Link2AIError('EXTRACTION_FAILED','Reddit response exceeded the safe content limit.',502,false,{transport:'reddit_oauth',cause_code:'response_too_large'});
  const ct=(response.headers.get('content-type')??'').toLowerCase();
  if(ct&&!ct.includes('json'))throw new Link2AIError('EXTRACTION_FAILED','Reddit Data API returned a non-JSON response.',502,true,{transport:'reddit_oauth',cause_code:`non_json_${response.status}`});
  try{return JSON.parse(bytes.toString('utf8'));}
  catch{throw new Link2AIError('EXTRACTION_FAILED','Reddit Data API returned malformed JSON.',502,true,{transport:'reddit_oauth',cause_code:'invalid_json'});}
}

async function fetchRedditPost(input:ParsedMediaUrl):Promise<LinkTextPayload>{
  if(!redditOAuthConfigured()){
    throw new Link2AIError(
      'PLATFORM_BLOCKED',
      'Reddit reads are temporarily unavailable while approved Reddit Data API access is being configured.',
      503,false,{cause_code:'reddit_oauth_not_configured',transport:'reddit_oauth'}
    );
  }
  return parseRedditJson(input,await redditOAuthJson(input.canonicalMediaId));
}

function collectGalleryCandidates'''
s, n = reddit_block.subn(new_reddit, s, count=1)
if n != 1:
    raise SystemExit(f'reddit oauth replacement: expected 1, got {n}')
p.write_text(s, encoding='utf-8')

# --- MCP: do not advertise Reddit as live until approved OAuth is configured ---
p = Path('src/mcp/server.ts')
s = p.read_text(encoding='utf-8')
s = replace_once(
    s,
    "export function buildMcpServer(){\n  const server=new McpServer({name:env().PUBLIC_BRAND_NAME,version:'1.3.0'},{instructions:`${env().PUBLIC_BRAND_NAME} is the source reader for supported public links. When the user provides a supported public Reddit, YouTube/Shorts, TikTok, Instagram, X, Bluesky, GitHub Issue/PR, Hacker News, readable webpage/article, or text-layer PDF link and asks a question that requires the contents of that link, use read_public_link before concluding that the source is inaccessible or asking the user to paste its contents. If a built-in browser/fetch attempt fails on a supported source, try ${env().PUBLIC_BRAND_NAME} rather than stopping at that failure. Do not use ${env().PUBLIC_BRAND_NAME} for unrelated URLs, profiles, feeds, timelines, private/login-gated content, broad crawling, or when the user explicitly asks not to fetch external content.`});\n\n  const readPublicLinkConfig={\n",
    "export function buildMcpServer(){\n  const e=env();\n  const redditReady=Boolean(e.REDDIT_CLIENT_ID?.trim()&&e.REDDIT_CLIENT_SECRET?.trim());\n  const supportedSources=`${redditReady?'Reddit, ':''}YouTube/Shorts, TikTok, Instagram, X, Bluesky, GitHub Issue/PR, Hacker News, readable webpage/article, or text-layer PDF`;\n  const server=new McpServer({name:e.PUBLIC_BRAND_NAME,version:'1.4.0'},{instructions:`${e.PUBLIC_BRAND_NAME} is the source reader for supported public links. When the user provides a supported public ${supportedSources} link and asks a question that requires the contents of that link, use read_public_link before concluding that the source is inaccessible or asking the user to paste its contents. If a built-in browser/fetch attempt fails on a supported source, try ${e.PUBLIC_BRAND_NAME} rather than stopping at that failure. Do not use ${e.PUBLIC_BRAND_NAME} for unrelated URLs, profiles, feeds, timelines, private/login-gated content, broad crawling, or when the user explicitly asks not to fetch external content.${redditReady?'':' Reddit is not currently advertised because this deployment does not have approved Reddit OAuth Data API credentials configured.'}`});\n\n  const readPublicLinkConfig={\n",
    'dynamic MCP instructions'
)
s = s.replace("supported public Reddit, YouTube/Shorts, TikTok, Instagram, X, Bluesky, GitHub Issue/PR, Hacker News, readable webpage/article, or text-layer PDF URL", "supported public ${supportedSources} URL")
s = s.replace("public YouTube/Shorts, TikTok videos, Instagram Reels/posts, individual X, Reddit and Bluesky posts, GitHub issues/pull requests, Hacker News discussions, text-layer PDFs, and readable public HTTPS webpages/articles", "public ${supportedSources} links")
p.write_text(s, encoding='utf-8')

# --- Homepage simulation: stable reset/run state machine + honest Reddit state + cache bust ---
p = Path('src/api/main.ts')
s = p.read_text(encoding='utf-8')
s = replace_once(s, '<button class="sim-tab active" type="button" data-sim-source="reddit">Reddit</button>\n            <button class="sim-tab" type="button" data-sim-source="youtube">YouTube</button>', '<button class="sim-tab" type="button" data-sim-source="reddit">Reddit · paused</button>\n            <button class="sim-tab active" type="button" data-sim-source="youtube">YouTube</button>', 'simulation default tab')
s = replace_once(s, '<strong class="sim-source-name" id="sim-source-name">Reddit thread</strong><code class="sim-url" id="sim-url">reddit.com/r/ClaudeAI/comments/…</code>', '<strong class="sim-source-name" id="sim-source-name">YouTube video</strong><code class="sim-url" id="sim-url">youtube.com/watch?v=…</code>', 'simulation default source')
s = replace_once(s, '<p id="sim-question-text">What are people disagreeing about in this Reddit thread?</p>', '<p id="sim-question-text">What is this YouTube video arguing, and what evidence does it use?</p>', 'simulation default question')
s = replace_once(s, '<button class="source-button active" type="button" data-source-key="reddit"><span class="source-glyph">R</span><strong>Reddit</strong></button>\n            <button class="source-button" type="button" data-source-key="youtube"><span class="source-glyph">▶</span><strong>YouTube</strong></button>', '<button class="source-button" type="button" data-source-key="reddit"><span class="source-glyph">R</span><strong>Reddit · paused</strong></button>\n            <button class="source-button active" type="button" data-source-key="youtube"><span class="source-glyph">▶</span><strong>YouTube</strong></button>', 'source explorer default')
s = replace_once(s, '<div class="source-preview-top"><span id="source-preview-label">Reddit · public discussion</span><div class="source-public-pill">supported public links</div></div>\n            <h3 id="source-preview-title">Ask about the discussion, not the URL.</h3>\n            <div class="source-preview-question" id="source-preview-question">“What are people disagreeing about in this Reddit thread?”</div>\n            <div class="source-mini-result" id="source-mini-result"><strong>What changes</strong>Claude can answer from the thread context instead of asking you to paste the post and comments manually.</div>', '<div class="source-preview-top"><span id="source-preview-label">YouTube · public video</span><div class="source-public-pill">supported public links</div></div>\n            <h3 id="source-preview-title">Turn the video into a conversation.</h3>\n            <div class="source-preview-question" id="source-preview-question">“What is this video arguing, and what evidence does it use?”</div>\n            <div class="source-mini-result" id="source-mini-result"><strong>What changes</strong>Link2AI can supply transcript-based source context for supported public videos.</div>', 'source explorer preview')
s = s.replace('<div class="proof-slot"><div class="proof-slot-head"><strong>Reddit</strong><span>Real capture slot</span></div><div class="proof-shot"><div class="proof-shot-line"></div><div class="proof-shot-line"></div><div class="proof-shot-line"></div></div><p><strong>Will show:</strong> original public URL → Claude without Link2AI → Claude with Link2AI.</p></div>', '<div class="proof-slot"><div class="proof-slot-head"><strong>Web</strong><span>Real capture slot</span></div><div class="proof-shot"><div class="proof-shot-line"></div><div class="proof-shot-line"></div><div class="proof-shot-line"></div></div><p><strong>Will show:</strong> the same readable public page and prompt, with the actual source-aware result.</p></div>')
s = s.replace('Try: “What are people disagreeing about in this Reddit thread?” or “What are the main claims in this video?”', 'Try: “What are the main claims in this video?” or “Review this GitHub Issue and suggest the next fix.”')
s = s.replace("reddit:{label:'Reddit · public discussion',title:'Ask about the discussion, not the URL.',question:'“What are people disagreeing about in this Reddit thread?”',result:'Claude can answer from the thread context instead of asking you to paste the post and comments manually.',sim:'reddit'},", "reddit:{label:'Reddit · temporarily paused',title:'Reddit now requires approved Data API access from hosted services.',question:'Link2AI will re-enable Reddit after approved OAuth access is configured.',result:'We do not bypass Reddit’s access controls. Failed or unavailable reads cost 0 units.',sim:null},")

state_re = re.compile(r"      const state=\{source:'reddit',timers:\[\]\};.*?      setTimer\(runDemo,650\);", re.S)
new_state = r'''      const state={source:'youtube',timers:new Set(),runId:0,interacted:false};
      const clearTimers=()=>{for(const id of state.timers)clearTimeout(id);state.timers.clear();};
      const setTimer=(fn,ms,runId=state.runId)=>{const id=setTimeout(()=>{state.timers.delete(id);if(runId!==state.runId)return;fn();},ms);state.timers.add(id);return id;};
      const resetDemo=(markInteraction=false)=>{if(markInteraction)state.interacted=true;state.runId++;clearTimers();q('#sim-left-state').textContent='Ready';q('#sim-right-state').textContent='Ready';q('#sim-left-state').className='sim-state';q('#sim-right-state').className='sim-state';q('#sim-left-answer').classList.remove('show');q('#sim-right-answer').classList.remove('show');q('#sim-left-answer').innerHTML='';q('#sim-right-answer').innerHTML='';q('#sim-tool').classList.remove('show');q('#sim-tool').innerHTML='Link2AI · Reading source… <i>connected</i>';q('#sim-conclusion').classList.remove('show');q('#sim-conclusion').hidden=true;qa('#sim-left-thinking .sim-line,#sim-right-thinking .sim-line').forEach(el=>el.classList.remove('live'));};
      const renderDemoSource=(key)=>{const d=demos[key];if(!d)return;state.source=key;q('#sim-source-name').textContent=d.name;q('#sim-url').textContent=d.url;q('#sim-question-text').textContent=d.question;qa('.sim-tab').forEach(b=>b.classList.toggle('active',b.dataset.simSource===key));resetDemo();};
      const renderAnswer=(el,lead,points)=>{el.innerHTML='<span class="sim-example-tag">Example output · representative</span><strong>'+lead+'</strong><ul>'+points.map(x=>'<li>'+x+'</li>').join('')+'</ul>';};
      const runDemo=(markInteraction=false)=>{if(markInteraction)state.interacted=true;resetDemo();const runId=state.runId;const d=demos[state.source];const reduced=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;const t=reduced?0:1;q('#sim-left-state').textContent='Trying source';q('#sim-right-state').textContent='Starting';q('#sim-left-state').className='sim-state reading';q('#sim-right-state').className='sim-state reading';qa('#sim-left-thinking .sim-line,#sim-right-thinking .sim-line').forEach(el=>el.classList.add('live'));setTimer(()=>{q('#sim-tool').classList.add('show');q('#sim-right-state').textContent='Reading';},350*t,runId);setTimer(()=>{q('#sim-left-state').textContent='Blocked';q('#sim-left-state').className='sim-state failed';qa('#sim-left-thinking .sim-line').forEach(el=>el.classList.remove('live'));q('#sim-left-answer').innerHTML='<span class="sim-example-tag">Claude</span>'+d.fail;q('#sim-left-answer').classList.add('show');},900*t,runId);setTimer(()=>{q('#sim-tool').innerHTML='Link2AI · Source loaded <i>ready</i>';q('#sim-right-state').textContent='Source loaded';q('#sim-right-state').className='sim-state loaded';},1300*t,runId);setTimer(()=>{qa('#sim-right-thinking .sim-line').forEach(el=>el.classList.remove('live'));renderAnswer(q('#sim-right-answer'),d.lead,d.points);q('#sim-right-answer').classList.add('show');},1750*t,runId);setTimer(()=>{q('#sim-conclusion').hidden=false;q('#sim-conclusion').classList.add('show');},2150*t,runId);};
      qa('.sim-tab').forEach(btn=>btn.addEventListener('click',()=>{state.interacted=true;renderDemoSource(btn.dataset.simSource);if(btn.dataset.simSource==='reddit'){q('#sim-right-state').textContent='Temporarily paused';q('#sim-right-state').className='sim-state failed';q('#sim-tool').classList.add('show');q('#sim-tool').innerHTML='Reddit · Approved OAuth access required <i>0 units</i>';q('#sim-right-answer').innerHTML='<span class="sim-example-tag">Current availability</span>Reddit reads are paused on this deployment rather than bypassing Reddit’s hosted-service access controls.';q('#sim-right-answer').classList.add('show');return;}runDemo(false);}));q('#sim-run').addEventListener('click',()=>runDemo(true));q('#sim-reset').addEventListener('click',()=>resetDemo(true));
      const showSource=(key)=>{const d=sourceExplore[key];if(!d)return;qa('.source-button').forEach(b=>b.classList.toggle('active',b.dataset.sourceKey===key));q('#source-preview-label').textContent=d.label;q('#source-preview-title').textContent=d.title;q('#source-preview-question').textContent=d.question;q('#source-mini-result').innerHTML='<strong>What changes</strong>'+d.result;q('#source-open-sim').hidden=!d.sim;q('#source-open-sim').dataset.sim=d.sim||'';};
      qa('.source-button').forEach(btn=>btn.addEventListener('click',()=>{state.interacted=true;showSource(btn.dataset.sourceKey);}));q('#source-open-sim').addEventListener('click',(e)=>{state.interacted=true;const key=e.currentTarget.dataset.sim;if(!key)return;renderDemoSource(key);document.getElementById('simulation').scrollIntoView({behavior:'smooth'});setTimer(()=>runDemo(false),420,state.runId);});
      const showUsecase=(key)=>{const d=usecases[key];if(!d)return;qa('.usecase-option').forEach(b=>b.classList.toggle('active',b.dataset.usecase===key));q('#usecase-user').textContent=d.prompt;q('#usecase-result').innerHTML='<div class="usecase-result-label">Example output · representative</div><strong>'+d.lead+'</strong><ul>'+d.points.map(x=>'<li>'+x+'</li>').join('')+'</ul>';};
      qa('.usecase-option').forEach(btn=>btn.addEventListener('click',()=>showUsecase(btn.dataset.usecase)));
      const reveals=qa('.reveal');if('IntersectionObserver' in window&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches){const io=new IntersectionObserver(entries=>{entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('in');io.unobserve(entry.target);}});},{threshold:.13});reveals.forEach(el=>io.observe(el));}else{reveals.forEach(el=>el.classList.add('in'));}
      setTimer(()=>{if(!state.interacted)runDemo(false);},650,state.runId);'''
s, n = state_re.subn(new_state, s, count=1)
if n != 1:
    raise SystemExit(f'simulation state replacement: expected 1, got {n}')
s = replace_once(s, '<script src="/home.js?v=20260917" defer></script>', '<script src="/home.js?v=20260917-r13" defer></script>', 'home js version')
s = replace_once(s, "app.get('/home.js',async(_req,reply)=>reply.header('Cache-Control','public,max-age=300').type('application/javascript; charset=utf-8').send(homeExperienceJs));", "app.get('/home.js',async(_req,reply)=>reply.header('Cache-Control','no-cache, max-age=0, must-revalidate').type('application/javascript; charset=utf-8').send(homeExperienceJs));", 'home js caching')
p.write_text(s, encoding='utf-8')

# --- Runtime regression: use a queued fake clock so stale callbacks after Reset are tested ---
p = Path('test/runtime-smoke.mjs')
s = p.read_text(encoding='utf-8')
s = s.replace("assert.match(body,/src=\"\\/home\\.js\\?v=20260917\" defer/);", "assert.match(body,/src=\"\\/home\\.js\\?v=20260917-r13\" defer/);")
s = s.replace("fetch(`http://127.0.0.1:${port}/home.js?v=20260917`", "fetch(`http://127.0.0.1:${port}/home.js?v=20260917-r13`")
clock_re = re.compile(r"  const fakeWindow=\{matchMedia:\(\)=>\(\{matches:true\}\)\};.*?  assert\.match\(ids\['sim-tool'\]\.innerHTML,/Reading source/,'Reset must restore the tool card before another run'\);", re.S)
new_clock = r'''  const fakeWindow={matchMedia:()=>({matches:false})};
  let nextTimerId=1;
  const timers=new Map();
  const queuedTimer=(fn,ms)=>{const id=nextTimerId++;timers.set(id,{fn,ms});return id;};
  const queuedClear=(id)=>{timers.delete(id);};
  const runNextTimer=()=>{const entry=[...timers.entries()].sort((a,b)=>a[1].ms-b[1].ms||a[0]-b[0])[0];if(!entry)return false;timers.delete(entry[0]);entry[1].fn();return true;};
  const runAllTimers=()=>{let guard=0;while(runNextTimer()){if(++guard>100)throw new Error('timer loop');}};
  assert.doesNotThrow(()=>new Function('document','window','setTimeout','clearTimeout',homeJs)(fakeDocument,fakeWindow,queuedTimer,queuedClear),'homepage interaction JS must execute');
  // Autoplay is queued, not magically completed. User Reset must cancel it.
  assert.equal(ids['sim-left-state'].textContent,'','simulation should not jump ahead before timers run');
  ids['sim-reset'].listeners.click();
  runAllTimers();
  assert.equal(ids['sim-left-state'].textContent,'Ready','Reset must cancel queued autoplay and keep left Ready');
  assert.equal(ids['sim-right-state'].textContent,'Ready','Reset must cancel queued autoplay and keep right Ready');
  // A real Run should survive the previous Reset and complete every stage.
  ids['sim-run'].listeners.click();
  assert.equal(ids['sim-left-state'].textContent,'Trying source');
  assert.equal(ids['sim-right-state'].textContent,'Starting');
  assert.ok(runNextTimer(),'first staged timer should exist');
  assert.equal(ids['sim-right-state'].textContent,'Reading');
  // Reset in the middle of a run must invalidate every stale callback.
  ids['sim-reset'].listeners.click();
  runAllTimers();
  assert.equal(ids['sim-left-state'].textContent,'Ready','mid-run Reset must defeat stale left callbacks');
  assert.equal(ids['sim-right-state'].textContent,'Ready','mid-run Reset must defeat stale right callbacks');
  assert.equal(ids['sim-conclusion'].hidden,true,'mid-run Reset must keep conclusion hidden');
  // Run again after Reset and complete the whole comparison.
  ids['sim-run'].listeners.click();
  runAllTimers();
  assert.equal(ids['sim-left-state'].textContent,'Blocked','rerun after Reset must reach blocked state');
  assert.equal(ids['sim-right-state'].textContent,'Source loaded','rerun after Reset must reach loaded state');
  assert.equal(ids['sim-conclusion'].hidden,false,'rerun after Reset must reveal conclusion');
  assert.ok(ids['sim-right-answer'].classList.contains('show'),'rerun after Reset must reveal the answer');
  // Switching source during a run must invalidate old-source callbacks.
  ids['sim-run'].listeners.click();
  assert.ok(runNextTimer());
  simTabs[2].listeners.click();
  runAllTimers();
  assert.match(ids['sim-url'].textContent,/github\.com/,'source tabs must switch simulation content');
  assert.equal(ids['sim-right-state'].textContent,'Source loaded','new source run must complete without stale timers');
  ids['sim-reset'].listeners.click();
  assert.equal(ids['sim-left-state'].textContent,'Ready','final Reset must restore left state');
  assert.equal(ids['sim-right-state'].textContent,'Ready','final Reset must restore right state');
  assert.match(ids['sim-tool'].innerHTML,/Reading source/,'Reset must restore the tool card before another run');'''
s, n = clock_re.subn(new_clock, s, count=1)
if n != 1:
    raise SystemExit(f'runtime fake clock replacement: expected 1, got {n}')
p.write_text(s, encoding='utf-8')

# --- Tests: include comprehensive source matrix ---
p = Path('package.json')
s = p.read_text(encoding='utf-8')
s = replace_once(s, 'node test/pure.mjs && node test/reddit-share-schema.mjs && node test/reddit-egress-schema.mjs', 'node test/pure.mjs && node test/source-matrix.mjs && node test/reddit-share-schema.mjs && node test/reddit-egress-schema.mjs', 'package test matrix')
p.write_text(s, encoding='utf-8')

# Share schema semantics changed: opaque shares are recognized but intentionally fail before quota rather than scraping redirects.
p = Path('test/reddit-share-schema.mjs')
s = p.read_text(encoding='utf-8')
s = s.replace("assert.match(linkSource,/export async function resolveRedditSharePost/,'Reddit share URLs need a network canonicalization step');\nassert.match(linkSource,/resolveRedditShareCandidate/,'Reddit share resolver must validate the canonical candidate');", "assert.match(linkSource,/export async function resolveRedditSharePost/,'Reddit share URLs need an explicit pre-quota handling step');\nassert.match(linkSource,/reddit_opaque_share_url/,'Opaque Reddit share URLs must fail clearly without scraping around access controls');")
p.write_text(s, encoding='utf-8')

# Reddit egress schema: official OAuth only, no browser-impersonation fallback.
p = Path('test/reddit-egress-schema.mjs')
s = p.read_text(encoding='utf-8')
s = '''import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const [source,envSource,mcpSource]=await Promise.all([
  readFile(new URL('../src/content/linkText.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/config/env.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/mcp/server.ts',import.meta.url),'utf8')
]);
assert.match(envSource,/REDDIT_CLIENT_ID/);
assert.match(envSource,/REDDIT_CLIENT_SECRET/);
assert.match(source,/https:\/\/www\.reddit\.com\/api\/v1\/access_token/,'Reddit must obtain an OAuth access token');
assert.match(source,/https:\/\/oauth\.reddit\.com\/comments\//,'Reddit content must use the OAuth Data API host');
assert.match(source,/grant_type=client_credentials/);
assert.match(source,/reddit_oauth_not_configured/,'Missing approved OAuth must fail explicitly');
assert.match(source,/503,false,\{cause_code:'reddit_oauth_not_configured'/,'Missing OAuth must be non-retryable');
assert.doesNotMatch(source,/curl_cffi/,'Reddit must not use browser fingerprint impersonation to bypass platform controls');
assert.doesNotMatch(source,/old\.reddit\.com\/comments\/\$\{id\}/,'Reddit must not fall back to scraping old.reddit HTML');
assert.match(mcpSource,/redditReady/,'MCP source advertising must reflect Reddit runtime readiness');
console.log('reddit egress schema tests PASS');
'''
p.write_text(s, encoding='utf-8')
