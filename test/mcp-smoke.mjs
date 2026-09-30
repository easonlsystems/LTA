import assert from 'node:assert/strict';

process.env.DATABASE_URL='postgres://127.0.0.1:1/link2ai';
process.env.PUBLIC_BASE_URL='http://localhost:3000';
process.env.APP_SECRET='01234567890123456789012345678901';
process.env.PUBLIC_BRAND_NAME='LaunchBrand';

const [{createMcpHandler},{buildMcpServer,unicodeSafeSlice,chunkResult,selectTimedSegmentWindow,searchSourceText,searchVideoSegments,buildVideoMap},{pool}]=await Promise.all([
  import('@modelcontextprotocol/server'),
  import('../dist/src/mcp/server.js'),
  import('../dist/src/db/pool.js')
]);

const {OPENAI_SKILL_MD,OPENAI_SKILL_URI,OPENAI_SKILL_DIGEST}=await import('../dist/src/mcp/openaiSkill.js');

const unicodeChunk=unicodeSafeSlice(`a😀b`,0,2);
assert.equal(unicodeChunk.text,'a');
assert.equal(unicodeChunk.end,1);
assert.equal(unicodeSafeSlice(`a😀b`,2,2).text,'😀');

const longSource='a'.repeat(120_000);
const firstChunk=chunkResult({
  status:'completed',job_id:'00000000-0000-4000-8000-000000000001',platform:'web',
  source_url:'https://example.com/article',language:'en',transcript_source:'page',
  transcript:longSource,segments:[],truncated:false,extracted_token_estimate:30_000,usage_units:12
});
assert.equal(firstChunk.continuation_required,true);
assert.equal(firstChunk.delivery_complete,false);
assert.equal(firstChunk.content_complete,false);
assert.equal(firstChunk.next_offset,50_000);
assert.equal(firstChunk.remaining_characters,70_000);
assert.match(firstChunk.continuation_notice,/More source text remains/);

const finalChunk=chunkResult({
  status:'completed',job_id:'00000000-0000-4000-8000-000000000001',platform:'web',
  source_url:'https://example.com/article',language:'en',transcript_source:'page',
  transcript:longSource,segments:[],truncated:false,extracted_token_estimate:30_000,usage_units:12
},100_000,50_000);
assert.equal(finalChunk.continuation_required,false);
assert.equal(finalChunk.delivery_complete,true);
assert.equal(finalChunk.content_complete,true);

const partialChunk=chunkResult({
  status:'completed',job_id:'00000000-0000-4000-8000-000000000002',platform:'pdf',
  source_url:'https://example.com/report.pdf',language:'en',transcript_source:'page',
  transcript:'partial pdf',segments:[],truncated:true,truncation_reason:'safe_content_limit',
  extracted_token_estimate:3,usage_units:1,pages_available:400,pages_extracted:250,
  content_sections_truncated:['pages']
});
assert.equal(partialChunk.source_completeness,'partial');
assert.equal(partialChunk.content_complete,false);
assert.match(partialChunk.limitation_notice,/250 of 400 pages/);

const unverifiedVideo=chunkResult({
  status:'completed',job_id:'00000000-0000-4000-8000-000000000003',platform:'youtube',
  source_url:'https://www.youtube.com/watch?v=test',language:'en',transcript_source:'asr',
  transcript:'spoken words',segments:[],duration_seconds:600,truncated:false,
  extracted_token_estimate:3,usage_units:10
});
assert.equal(unverifiedVideo.source_completeness,'unverified');
assert.equal(unverifiedVideo.timeline_coverage_verified,false);
assert.equal(unverifiedVideo.content_complete,false);

const timed=selectTimedSegmentWindow([
  {start:0,end:10,text:'intro'},
  {start:2220,end:2240,text:'target section one'},
  {start:2240,end:2260,text:'target section two'},
  {start:2600,end:2610,text:'outside range'}
],2220,2520);
assert.equal(timed.segment_count,2);
assert.match(timed.timed_text,/37:00–37:20/);
assert.match(timed.timed_text,/target section two/);
assert.doesNotMatch(timed.timed_text,/outside range/);
assert.equal(timed.delivery_complete,true);
assert.equal(timed.next_start_seconds,null);

const timedPaged=selectTimedSegmentWindow([
  {start:10,end:20,text:'a'.repeat(80)},
  {start:20,end:30,text:'b'.repeat(80)}
],0,60,100);
assert.equal(timedPaged.segment_count,1);
assert.equal(timedPaged.delivery_complete,false);
assert.equal(timedPaged.next_start_seconds,20);

const englishMatches=searchSourceText(
  'Opening remarks. The founder explains the launch plan. Later, she says the company decided to leave the market because distribution costs became too high. Closing remarks.',
  'quit leave market distribution costs',
  3
);
assert.ok(englishMatches.length>=1);
assert.match(englishMatches[0].snippet,/leave the market/i);

const cjkMatches=searchSourceText(
  '前面先介紹背景。中間開始討論離職原因，主要是因為產品方向和團隊目標不同。最後談到下一步規劃。',
  '為什麼離職 產品方向',
  3
);
assert.ok(cjkMatches.length>=1);
assert.match(cjkMatches[0].snippet,/離職原因/);

assert.deepEqual(searchSourceText('unrelated source text','quantum entanglement',5),[]);

const videoMatches=searchVideoSegments([
  {start:0,end:20,text:'intro and setup'},
  {start:90,end:110,text:'the founder explains distribution costs and why they left the market'},
  {start:180,end:200,text:'closing thoughts'}
],'why leave market distribution costs',3);
assert.equal(videoMatches.length,1);
assert.equal(videoMatches[0].start_seconds,90);
assert.match(videoMatches[0].snippet,/distribution costs/i);

const videoMap=buildVideoMap([
  {start:0,end:60,text:'intro overview launch background'},
  {start:120,end:180,text:'pricing distribution costs market strategy'},
  {start:240,end:300,text:'team hiring product roadmap next steps'}
],120,10);
assert.equal(videoMap.effective_window_seconds,120);
assert.equal(videoMap.sections.length,3);
assert.equal(videoMap.sections[0].start_seconds,0);
assert.match(videoMap.sections[1].excerpt,/distribution costs/i);
assert.ok(videoMap.sections[1].keywords.length>0);

const longVideoMap=buildVideoMap(
  Array.from({length:20},(_,i)=>({start:i*600,end:i*600+300,text:`section ${i} repeated topic topic`})),
  180,
  10
);
assert.ok(longVideoMap.effective_window_seconds>=1170,'video map should widen windows enough to cover the full timeline within max_windows');
assert.ok(longVideoMap.sections.length<=10);

const handler=createMcpHandler(buildMcpServer);
const openaiConstructionAudit=buildMcpServer('openai');
assert.deepEqual(
  openaiConstructionAudit.server.getCapabilities().extensions?.['io.modelcontextprotocol/skills'],
  {},
  'OpenAI MCP construction must retain the skills extension capability'
);
const openaiHandler=createMcpHandler(()=>buildMcpServer('openai'));
const authInfo={
  token:'test',clientId:'test',scopes:['link2ai:read'],
  extra:{userId:'00000000-0000-4000-8000-000000000000'}
};

async function call(body){
  const response=await handler.fetch(new Request('http://localhost/mcp',{
    method:'POST',
    headers:{'content-type':'application/json','accept':'application/json, text/event-stream'},
    body:JSON.stringify(body)
  }),{authInfo,parsedBody:body});
  assert.equal(response.status,200);
  const text=await response.text();
  const line=text.split(/\r?\n/).find(value=>value.startsWith('data: '));
  assert.ok(line,'MCP response must contain an SSE data event');
  return JSON.parse(line.slice(6));
}

async function callOpenai(body){
  const response=await openaiHandler.fetch(new Request('http://localhost/mcp/openai',{
    method:'POST',
    headers:{'content-type':'application/json','accept':'application/json, text/event-stream'},
    body:JSON.stringify(body)
  }),{authInfo,parsedBody:body});
  const text=await response.text();
  assert.equal(response.status,200,'OpenAI MCP returned '+response.status+' for '+body.method+': '+text);

  const line=text.split(/\r?\n/).find(value=>value.startsWith('data: '));
  assert.ok(line,'OpenAI MCP response must contain an SSE data event');
  return JSON.parse(line.slice(6));
}

try{
  const initialized=await call({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'audit',version:'1'}}});
  assert.equal(initialized.result.serverInfo.name,'LaunchBrand');
  assert.match(initialized.result.instructions??'',/provides AI-readable context from supported public links/i);
  assert.match(initialized.result.instructions??'',/source identity, completeness\/provenance metadata/i);

  const listed=await call({jsonrpc:'2.0',id:2,method:'tools/list',params:{}});
  assert.deepEqual(listed.result.tools.map(tool=>tool.name),['read_public_link','read_public_links','get_video_transcript','get_transcript_result','get_visual_assets','get_video_time_range','find_in_link','get_video_map','get_usage']);
  assert.match(listed.result.tools[0].description,/Read one supported public URL/i);
  assert.match(listed.result.tools[0].description,/Profiles, feeds, private\/login-gated content/i);
  assert.match(listed.result.tools[1].description,/two or more supported public URLs/i);
  assert.match(listed.result.tools[1].description,/comparison|synthesis/i);
  assert.match(listed.result.tools[2].description,/Compatibility reader for existing LTA connections/i);
  assert.match(listed.result.tools[3].description,/LaunchBrand/);
  assert.match(listed.result.tools[4].description,/attached images/i);
  assert.match(listed.result.tools[5].description,/timestamped transcript text/i);
  assert.match(listed.result.tools[6].description,/Search the text of an already processed LTA source/i);
  assert.match(listed.result.tools[7].description,/compact timeline map/i);
  assert.doesNotMatch(JSON.stringify(listed.result.tools),/\$\{env\(\)/);
  assert.deepEqual(listed.result.tools[0].annotations,{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:true});
  assert.deepEqual(listed.result.tools[1].annotations,{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:true});
  assert.deepEqual(listed.result.tools[2].annotations,{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:true});
  assert.equal(listed.result.tools[3].annotations.readOnlyHint,true);
  assert.equal(listed.result.tools[4].annotations.readOnlyHint,true);
  assert.equal(listed.result.tools[5].annotations.readOnlyHint,true);
  assert.equal(listed.result.tools[6].annotations.readOnlyHint,true);
  assert.equal(listed.result.tools[7].annotations.readOnlyHint,true);
  assert.equal(listed.result.tools[8].annotations.readOnlyHint,true);
  for(const tool of listed.result.tools){
    assert.deepEqual(tool.securitySchemes,[{type:'oauth2',scopes:['link2ai:read']}],tool.name+' must declare OAuth explicitly for ChatGPT plugin review');
    assert.ok(tool.outputSchema&&tool.outputSchema.type==='object',tool.name+' must publish an output schema');
  }
  assert.ok(listed.result.tools[0].outputSchema.properties.source_completeness,'read_public_link output schema must expose completeness');
  assert.ok(listed.result.tools[0].outputSchema.properties.continuation_required,'read_public_link output schema must expose pagination state');
  assert.ok(listed.result.tools[8].outputSchema.properties.remaining_usage_units,'get_usage output schema must expose remaining units');
  assert.match(listed.result.tools[8].description,/authoritative available processing-unit balance/i,'get_usage must identify the authoritative quota balance');
  assert.match(JSON.stringify(listed.result.tools[8].outputSchema.properties.limit_links),/null/,'Legacy link limit must allow null when there is no link-count cap');
  assert.match(JSON.stringify(listed.result.tools[8].outputSchema.properties.remaining_links),/null/,'Legacy remaining-link limit must allow null when there is no link-count cap');
  assert.match(listed.result.tools[8].outputSchema.properties.remaining_usage_units.description??'',/Authoritative processing units remaining/i);
  assert.ok(listed.result.tools[1].outputSchema.properties.results,'read_public_links must preserve per-source results');
  assert.ok(listed.result.tools[4].outputSchema.properties.visual_assets_delivered,'get_visual_assets must expose delivered image count');
  assert.ok(listed.result.tools[5].outputSchema.properties.timed_text,'get_video_time_range must expose timed source text');
  assert.ok(listed.result.tools[6].outputSchema.properties.matches,'find_in_link must expose ranked source matches');
  assert.ok(listed.result.tools[6].outputSchema.properties.matches.items.properties.start_seconds,'video source search must expose time ranges');
  assert.ok(listed.result.tools[7].outputSchema.properties.sections,'get_video_map must expose timeline sections');

  const openaiInitialized=await callOpenai({jsonrpc:'2.0',id:20,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'openai-audit',version:'1'}}});
  assert.match(openaiInitialized.result.instructions??'',/intentionally limited to Bluesky, GitHub Issue\/PR, and Hacker News/i);
  assert.match(openaiInitialized.result.instructions??'',/provides AI-readable context from supported public links/i);
  assert.doesNotMatch(openaiInitialized.result.instructions??'',/use get_video_time_range|use get_video_map/i);
  assert.deepEqual(
    openaiInitialized.result.capabilities?.extensions?.['io.modelcontextprotocol/skills'],
    {},
    'OpenAI MCP must advertise the skills extension under capabilities.extensions'
  );

  const openaiListed=await callOpenai({jsonrpc:'2.0',id:21,method:'tools/list',params:{}});
  assert.deepEqual(openaiListed.result.tools.map(tool=>tool.name),['read_public_link','read_public_links','get_transcript_result','get_visual_assets','find_in_link','get_usage']);
  const openaiResultTool=openaiListed.result.tools.find(tool=>tool.name==='get_transcript_result');
  assert.deepEqual(openaiResultTool.annotations,{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},'OpenAI result polling must remain closed-world; attached images use get_visual_assets');
  assert.doesNotMatch(JSON.stringify(openaiListed.result.tools),/get_video_transcript|get_video_time_range|get_video_map/);
  assert.match(openaiListed.result.tools[0].description,/Bluesky, GitHub Issue\/PR, or Hacker News/i);
  assert.match(openaiListed.result.tools[0].description,/Read one supported public URL/i);
  assert.doesNotMatch(openaiListed.result.tools[0].description,/YouTube|Instagram|TikTok|readable webpage|text-layer PDF/i);
  const openaiReadSchema=openaiListed.result.tools.find(tool=>tool.name==='read_public_link').outputSchema.properties;
  for(const field of ['source_key','source_fetched_at','cache_expires_at','extracted_token_estimate','transcript_source','transcript','topup_path']){
    assert.equal(openaiReadSchema[field],undefined,`OpenAI read schema must omit internal/redundant field ${field}`);
  }
  const openaiFindSchema=openaiListed.result.tools.find(tool=>tool.name==='find_in_link').outputSchema.properties;
  assert.equal(openaiFindSchema.source_key,undefined,'OpenAI find_in_link must omit the internal source key');
  const openaiUsageSchema=openaiListed.result.tools.find(tool=>tool.name==='get_usage').outputSchema.properties;
  assert.ok(openaiUsageSchema.remaining_usage_units,'OpenAI get_usage must expose authoritative remaining units');
  assert.equal(openaiUsageSchema.remaining_seconds,undefined,'OpenAI get_usage must not expose legacy seconds metadata');
  assert.equal(openaiUsageSchema.remaining_links,undefined,'OpenAI get_usage must not expose legacy link-count metadata');
  assert.equal(openaiUsageSchema.concurrent_jobs,undefined,'OpenAI get_usage must omit internal concurrency state');
  assert.equal(openaiUsageSchema.concurrency_limit,undefined,'OpenAI get_usage must omit internal concurrency limits');
  assert.equal(openaiUsageSchema.quota_exempt,undefined,'OpenAI get_usage must omit internal exemption flags');
  for(const tool of openaiListed.result.tools){
    assert.deepEqual(tool.securitySchemes,[{type:'oauth2',scopes:['link2ai:read']}],tool.name+' must declare OAuth explicitly on the ChatGPT endpoint');
    assert.ok(tool.outputSchema&&tool.outputSchema.type==='object',tool.name+' must publish an output schema on the ChatGPT endpoint');
  }

  const skillList=await callOpenai({jsonrpc:'2.0',id:22,method:'skills/list',params:{}});
  assert.equal(skillList.result.skills.length,1,'OpenAI MCP must publish exactly one submission skill');
  const skillEntry=skillList.result.skills[0];
  assert.equal(skillEntry.uri,OPENAI_SKILL_URI);
  assert.equal(skillEntry.frontmatter.name,'read-public-links-with-lta');
  assert.match(skillEntry.frontmatter.description,/Use LTA when a user's question depends on the contents of a supported public link/i);
  assert.deepEqual(skillEntry.resources,[{uri:OPENAI_SKILL_URI,digest:OPENAI_SKILL_DIGEST}]);
  assert.match(OPENAI_SKILL_DIGEST,/^sha256:[0-9a-f]{64}$/);

  const skillGet=await callOpenai({jsonrpc:'2.0',id:23,method:'skills/get',params:{uri:OPENAI_SKILL_URI}});
  assert.deepEqual(skillGet.result.skill,skillEntry,'skills/get must return the exact skills/list catalog entry');

  const skillResource=await callOpenai({jsonrpc:'2.0',id:24,method:'resources/read',params:{uri:OPENAI_SKILL_URI}});
  assert.equal(skillResource.result.contents.length,1);
  assert.equal(skillResource.result.contents[0].uri,OPENAI_SKILL_URI);
  assert.equal(skillResource.result.contents[0].mimeType,'text/markdown');
  assert.equal(skillResource.result.contents[0].text,OPENAI_SKILL_MD,'resources/read must return the exact bytes used for the advertised digest');


  // Assertions for the production capability contract: descriptions stay narrow and match actual source-reading behavior.
  const get_video_transcript_desc=listed.result.tools[2].description;
  assert.match(get_video_transcript_desc,/reads one supported public/i,'Compatibility description must state the source-reading capability');
  assert.match(get_video_transcript_desc,/New integrations should use read_public_link/i,'Compatibility description must point new integrations to the primary reader');
  assert.match(get_video_transcript_desc,/Profiles, feeds, private\/login-gated content/i,'Description must state unsupported source scope');
  assert.doesNotMatch(get_video_transcript_desc,/Reddit/i,'Without approved Reddit OAuth credentials, MCP must not advertise Reddit as live');
  assert.doesNotMatch(listed.result.tools[0].description,/Reddit/i,'Primary tool must also hide unavailable Reddit support');
  assert.match(listed.result.tools[1].description,/separate result for each source/i);
  assert.match(listed.result.tools[6].description,/lexical matching/i);
  assert.match(listed.result.tools[7].description,/overview of where topics appear/i);
  assert.doesNotMatch(listed.result.tools[0].description,/Reuse a successful result|native source access|Do not call LTA merely because/i);
  assert.ok(listed.result.tools[0].inputSchema.properties.refresh,'read_public_link must expose explicit refresh control');

  const batch=await call({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'read_public_links',arguments:{urls:['https://www.youtube.com/watch?v=dQw4w9WgXcQ','https://www.youtube.com/watch?v=dQw4w9WgXcQ']}}});
  assert.equal(batch.result.isError??false,false,'batch-level call should survive per-source failures');
  const batchPayload=JSON.parse(batch.result.content[0].text.split('\n').at(-1));
  assert.equal(batchPayload.status,'batch');
  assert.equal(batchPayload.source_count,2);
  assert.equal(batchPayload.unique_source_count,1,'duplicate canonical sources in one batch should be collapsed');
  assert.equal(batchPayload.results.length,1);
  assert.equal(batchPayload.results[0].status,'failed','one failed source must be represented inside the batch result');

  const failed=await call({jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'get_usage',arguments:{}}});
  assert.equal(failed.result.isError,true);
  const payload=JSON.parse(failed.result.content[0].text.split('\n').at(-1));
  assert.equal(payload.error_code,'INTERNAL_ERROR');
  assert.equal(payload.message,'LTA hit an internal error while processing this request. No processing units were charged.');
  assert.doesNotMatch(failed.result.content[0].text,/ECONNREFUSED|127\.0\.0\.1|postgres/i);
  console.log('MCP smoke tests PASS');
}finally{
  await Promise.all([handler.close(),openaiHandler.close()]);
  await pool.end();
}

