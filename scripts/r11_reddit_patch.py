from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, got {count}")
    return text.replace(old, new, 1)

# Reddit browser-fingerprint fallback.
p = Path('src/content/linkText.ts')
s = p.read_text(encoding='utf-8')
anchor = "async function fetchRedditPost(input:ParsedMediaUrl):Promise<LinkTextPayload>{\n"
helper = r'''async function fetchRedditJsonViaBrowserFingerprint(postId:string):Promise<unknown>{
  // Reddit can reset datacenter/Node TLS connections before an HTTP response exists.
  // The production image already ships curl_cffi (via yt-dlp[default,curl-cffi]); use
  // it only as a Reddit-specific transport fallback. Hosts are hard-coded here and the
  // canonical post id is passed as argv, so this does not become an arbitrary URL fetch.
  const python=`import sys\nfrom curl_cffi import requests\npost_id=sys.argv[1]\nlimit=sys.argv[2]\ndepth=sys.argv[3]\nurls=[\n f\"https://www.reddit.com/comments/{post_id}.json?raw_json=1&limit={limit}&depth={depth}&sort=top\",\n f\"https://old.reddit.com/comments/{post_id}.json?raw_json=1&limit={limit}&depth={depth}&sort=top\",\n f\"https://api.reddit.com/comments/{post_id}?raw_json=1&limit={limit}&depth={depth}&sort=top\"\n]\nheaders={\"accept\":\"application/json,text/plain,*/*\",\"accept-language\":\"en-US,en;q=0.9\",\"cache-control\":\"no-cache\"}\nlast=\"transport_failed\"\nfor url in urls:\n try:\n  response=requests.get(url,headers=headers,impersonate=\"chrome\",timeout=15,allow_redirects=True)\n  status=int(response.status_code)\n  if 200 <= status < 300:\n   body=response.content\n   if len(body)>3000000:\n    last=\"response_too_large\"\n    continue\n   sys.stdout.buffer.write(body)\n   raise SystemExit(0)\n  last=f\"http_{status}\"\n except SystemExit:\n  raise\n except Exception as exc:\n  last=type(exc).__name__\nprint(last,file=sys.stderr)\nraise SystemExit(2)\n`;
  let result;
  try{
    result=await runProcess('python3',['-c',python,postId,String(REDDIT_MAX_COMMENTS),String(REDDIT_MAX_DEPTH)],{timeoutMs:35_000,maxOutputBytes:3_250_000});
  }catch(error){
    throw new Link2AIError('EXTRACTION_FAILED','Reddit browser-transport fallback failed.',502,true,{transport:'curl_cffi',cause_code:error instanceof Error?error.name:'process_error'});
  }
  if(result.code!==0||!result.stdout.trim()){
    const token=(result.stderr.trim().split(/\s+/).pop()??'transport_failed').replace(/[^A-Za-z0-9_.-]/g,'').slice(0,80)||'transport_failed';
    throw new Link2AIError('EXTRACTION_FAILED','Reddit browser-transport fallback did not return a public post response.',502,true,{transport:'curl_cffi',cause_code:token});
  }
  try{return JSON.parse(result.stdout);}
  catch{throw new Link2AIError('EXTRACTION_FAILED','Reddit browser-transport fallback returned malformed JSON.',502,true,{transport:'curl_cffi',cause_code:'invalid_json'});}
}

'''
if helper in s:
    raise SystemExit('helper already present')
s = replace_once(s, anchor, helper + anchor, 'insert Reddit transport helper')
old = """  for(const endpoint of endpoints){\n    try{\n      const response=await safeGetBuffer(endpoint,{maxBytes:3_000_000,timeoutMs:15_000,maxRedirects:3,userAgent:BROWSER_UA,accept:'application/json,text/json;q=0.9'});\n      const ct=(response.contentType??'').toLowerCase();\n      if(ct&&!ct.includes('json')&&!ct.includes('javascript')&&!ct.includes('text/plain'))throw new Link2AIError('EXTRACTION_FAILED','Reddit returned a non-JSON response.',502,true);\n      let data:unknown;\n      try{data=JSON.parse(response.bytes.toString('utf8'));}\n      catch{throw new Link2AIError('EXTRACTION_FAILED','Reddit returned invalid public-post JSON.',502,true);}\n      return parseRedditJson(input,data);\n    }catch(error){lastError=error;}\n  }\n  // Final fallback for temporary JSON endpoint blocks. It is intentionally text-only;\n"""
new = """  for(const endpoint of endpoints){\n    try{\n      const response=await safeGetBuffer(endpoint,{maxBytes:3_000_000,timeoutMs:15_000,maxRedirects:3,userAgent:BROWSER_UA,accept:'application/json,text/json;q=0.9'});\n      const ct=(response.contentType??'').toLowerCase();\n      if(ct&&!ct.includes('json')&&!ct.includes('javascript')&&!ct.includes('text/plain'))throw new Link2AIError('EXTRACTION_FAILED','Reddit returned a non-JSON response.',502,true);\n      let data:unknown;\n      try{data=JSON.parse(response.bytes.toString('utf8'));}\n      catch{throw new Link2AIError('EXTRACTION_FAILED','Reddit returned invalid public-post JSON.',502,true);}\n      return parseRedditJson(input,data);\n    }catch(error){lastError=error;}\n  }\n  // If Reddit resets Node/datacenter TLS before sending any HTTP response, retry with\n  // curl_cffi's browser TLS fingerprint. This is still bounded to hard-coded Reddit\n  // hosts and the already-validated canonical post id.\n  try{return parseRedditJson(input,await fetchRedditJsonViaBrowserFingerprint(input.canonicalMediaId));}\n  catch(error){lastError=error;}\n\n  // Final fallback for temporary JSON endpoint blocks. It is intentionally text-only;\n"""
s = replace_once(s, old, new, 'wire Reddit transport fallback')
p.write_text(s, encoding='utf-8')

# Surface safe, whitelisted transport diagnostics in worker logs.
p = Path('src/worker/processor.ts')
s = p.read_text(encoding='utf-8')
old = """    const err=asLink2AIError(e);\n    logErrorEvent('job_error',e,{job_id:job.id,platform:job.platform,error_code:err.code,retryable:err.retryable,attempt:job.attempts,processing_ms:Date.now()-startedAt});\n"""
new = """    const err=asLink2AIError(e);\n    const causeCode=typeof err.details?.cause_code==='string'?err.details.cause_code.slice(0,80):undefined;\n    const transport=typeof err.details?.transport==='string'?err.details.transport.slice(0,40):undefined;\n    logErrorEvent('job_error',e,{job_id:job.id,platform:job.platform,error_code:err.code,retryable:err.retryable,attempt:job.attempts,processing_ms:Date.now()-startedAt,...(causeCode?{cause_code:causeCode}:{}),...(transport?{transport}:{} )});\n"""
s = replace_once(s, old, new, 'worker network diagnostics')
p.write_text(s, encoding='utf-8')

# Fail worker startup if the production runtime ever loses curl_cffi.
p = Path('src/worker/preflight.ts')
s = p.read_text(encoding='utf-8')
old = """  await requireBinary(env().YTDLP_BIN,['--version'],'yt-dlp');\n  await requireBinary(env().FFMPEG_BIN,['-version'],'FFmpeg');\n"""
new = """  await requireBinary(env().YTDLP_BIN,['--version'],'yt-dlp');\n  await requireBinary(env().FFMPEG_BIN,['-version'],'FFmpeg');\n  await requireBinary('python3',['-c','import curl_cffi; print(curl_cffi.__version__)'],'curl_cffi');\n"""
s = replace_once(s, old, new, 'curl_cffi worker preflight')
p.write_text(s, encoding='utf-8')

# Add a static regression that checks the production-only transport dependency and wiring.
test_path = Path('test/reddit-egress-schema.mjs')
test_path.write_text("""import assert from 'node:assert/strict';\nimport fs from 'node:fs';\n\nconst source=fs.readFileSync(new URL('../src/content/linkText.ts',import.meta.url),'utf8');\nconst worker=fs.readFileSync(new URL('../src/worker/preflight.ts',import.meta.url),'utf8');\nconst docker=fs.readFileSync(new URL('../Dockerfile',import.meta.url),'utf8');\n\nassert.ok(source.includes('fetchRedditJsonViaBrowserFingerprint'));\nassert.ok(source.includes('from curl_cffi import requests'));\nassert.match(source,/impersonate=.*chrome/);\nassert.ok(source.includes('https://www.reddit.com/comments/{post_id}'));\nassert.ok(source.includes('https://old.reddit.com/comments/{post_id}'));\nassert.ok(source.includes('https://api.reddit.com/comments/{post_id}'));\nassert.ok(source.includes('parseRedditJson(input,await fetchRedditJsonViaBrowserFingerprint(input.canonicalMediaId))'));\nassert.ok(!source.includes('fetchRedditJsonViaBrowserFingerprint(input.normalizedUrl)'));\nassert.ok(worker.includes('import curl_cffi'));\nassert.ok(docker.includes('yt-dlp[default,curl-cffi]'));\nconsole.log('reddit egress schema tests PASS');\n""", encoding='utf-8')

# Make the new regression part of every normal CI run.
p = Path('package.json')
s = p.read_text(encoding='utf-8')
s = replace_once(s, 'node test/reddit-share-schema.mjs && node test/quota.mjs', 'node test/reddit-share-schema.mjs && node test/reddit-egress-schema.mjs && node test/quota.mjs', 'package test chain')
p.write_text(s, encoding='utf-8')
