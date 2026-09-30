import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

process.env.DATABASE_URL='postgres://127.0.0.1:1/link2ai';
process.env.PUBLIC_BASE_URL='http://localhost:3000';
process.env.APP_SECRET='01234567890123456789012345678901';
process.env.PUBLIC_BRAND_NAME='LTA';

const [{createMcpHandler},{buildOpenAiFirstPartyServer},{pool},{OPENAI_FIRST_PARTY_SKILL_MD,OPENAI_FIRST_PARTY_SKILL_URI,OPENAI_FIRST_PARTY_SKILL_DIGEST}]=await Promise.all([
  import('@modelcontextprotocol/server'),
  import('../dist/src/mcp/openaiFirstParty.js'),
  import('../dist/src/db/pool.js'),
  import('../dist/src/mcp/openaiFirstPartySkill.js')
]);

const [firstPartySource,apiSource]=await Promise.all([
  readFile(new URL('../src/mcp/openaiFirstParty.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/api/main.ts',import.meta.url),'utf8')
]);

assert.doesNotMatch(firstPartySource,/source\/service|safeHttp|worker\/|provider|read_public_link|read_public_links|get_transcript_result|get_visual_assets|find_in_link|get_video_/,'OpenAI first-party surface must not depend on third-party source-reader paths');
assert.match(apiSource,/openaiMcpHandler=createMcpHandler\(\(\)=>buildOpenAiFirstPartyServer\(\)\)/,'Production /mcp/openai must use the first-party builder');
assert.doesNotMatch(apiSource,/openaiMcpHandler=createMcpHandler\(\(\)=>buildMcpServer\('openai'\)\)/,'Production /mcp/openai must not route to the legacy source-reading builder');

const handler=createMcpHandler(()=>buildOpenAiFirstPartyServer());
const authInfo={
  token:'test',clientId:'test',scopes:['link2ai:read'],
  extra:{userId:'00000000-0000-4000-8000-000000000000'}
};

async function call(body){
  const response=await handler.fetch(new Request('http://localhost/mcp/openai',{
    method:'POST',
    headers:{'content-type':'application/json','accept':'application/json, text/event-stream'},
    body:JSON.stringify(body)
  }),{authInfo,parsedBody:body});
  const raw=await response.text();
  assert.equal(response.status,200,'OpenAI first-party MCP returned '+response.status+': '+raw);
  const line=raw.split(/\r?\n/).find(value=>value.startsWith('data: '));
  assert.ok(line,'MCP response must contain an SSE data event');
  return JSON.parse(line.slice(6));
}

try{
  const initialized=await call({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'audit',version:'1'}}});
  assert.match(initialized.result.instructions??'',/first-party LTA account and planning companion/i);
  assert.match(initialized.result.instructions??'',/does not fetch, scrape, proxy, relay, or return content from third-party websites or APIs/i);
  assert.deepEqual(initialized.result.capabilities?.extensions?.['io.modelcontextprotocol/skills'],{});

  const listed=await call({jsonrpc:'2.0',id:2,method:'tools/list',params:{}});
  assert.deepEqual(listed.result.tools.map(tool=>tool.name),['check_link_support','get_supported_sources','estimate_processing_units','get_usage']);
  assert.doesNotMatch(JSON.stringify(listed.result.tools),/read_public_link|read_public_links|get_transcript_result|get_visual_assets|find_in_link|get_video_transcript|get_video_time_range|get_video_map/);
  for(const tool of listed.result.tools){
    assert.deepEqual(tool.securitySchemes,[{type:'oauth2',scopes:['link2ai:read']}],tool.name+' must declare OAuth');
    assert.deepEqual(tool.annotations,{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},tool.name+' must remain closed-world/read-only');
    assert.ok(tool.outputSchema&&tool.outputSchema.type==='object',tool.name+' must expose an output schema');
  }
  assert.match(listed.result.tools.find(tool=>tool.name==='check_link_support').description,/does not contact, fetch, scrape, proxy, or read/i);
  assert.match(listed.result.tools.find(tool=>tool.name==='get_usage').description,/first-party LTA account data/i);

  const support=await call({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'check_link_support',arguments:{url:'https://www.instagram.com/reel/DdNnHPip4RD/'}}});
  const supportData=JSON.parse(support.result.content[0].text);
  assert.equal(supportData.status,'recognized');
  assert.equal(supportData.source_type,'Instagram Reel / post');
  assert.equal(supportData.source_kind,'media');
  assert.equal(supportData.currently_supported_by_lta,true);
  assert.equal(supportData.directory_content_access,false);
  assert.equal(supportData.network_request_made,false);
  assert.match(supportData.message,/does not fetch or read the linked content/i);

  const adult=await call({jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'check_link_support',arguments:{url:'https://www.pornhub.com/view_video.php?viewkey=abc'}}});
  const adultData=JSON.parse(adult.result.content[0].text);
  assert.equal(adultData.status,'blocked');
  assert.equal(adultData.directory_content_access,false);
  assert.equal(adultData.network_request_made,false);

  const profile=await call({jsonrpc:'2.0',id:5,method:'tools/call',params:{name:'check_link_support',arguments:{url:'https://www.instagram.com/instagram/'}}});
  const profileData=JSON.parse(profile.result.content[0].text);
  assert.equal(profileData.status,'unsupported');
  assert.equal(profileData.network_request_made,false);

  const videoEstimate=await call({jsonrpc:'2.0',id:6,method:'tools/call',params:{name:'estimate_processing_units',arguments:{content_kind:'video',duration_seconds:125}}});
  const videoData=JSON.parse(videoEstimate.result.content[0].text);
  assert.equal(videoData.status,'estimated');
  assert.equal(videoData.estimated_processing_units,3);

  const textEstimate=await call({jsonrpc:'2.0',id:7,method:'tools/call',params:{name:'estimate_processing_units',arguments:{content_kind:'text',character_count:25000}}});
  const textData=JSON.parse(textEstimate.result.content[0].text);
  assert.equal(textData.status,'estimated');
  assert.equal(textData.estimated_processing_units,3);

  const catalog=await call({jsonrpc:'2.0',id:8,method:'tools/call',params:{name:'get_supported_sources',arguments:{}}});
  const catalogData=JSON.parse(catalog.result.content[0].text);
  assert.equal(catalogData.directory_content_access,false);
  assert.ok(catalogData.source_types.some(source=>source.platform==='youtube'));
  assert.ok(catalogData.source_types.some(source=>source.platform==='instagram'));

  const skillList=await call({jsonrpc:'2.0',id:9,method:'skills/list',params:{}});
  assert.equal(skillList.result.skills.length,1);
  assert.equal(skillList.result.skills[0].uri,OPENAI_FIRST_PARTY_SKILL_URI);
  assert.equal(skillList.result.skills[0].frontmatter.name,'use-lta-account-and-source-planning');
  assert.deepEqual(skillList.result.skills[0].resources,[{uri:OPENAI_FIRST_PARTY_SKILL_URI,digest:OPENAI_FIRST_PARTY_SKILL_DIGEST}]);

  const skillResource=await call({jsonrpc:'2.0',id:10,method:'resources/read',params:{uri:OPENAI_FIRST_PARTY_SKILL_URI}});
  assert.equal(skillResource.result.contents[0].text,OPENAI_FIRST_PARTY_SKILL_MD);
  assert.match(OPENAI_FIRST_PARTY_SKILL_MD,/does not fetch, scrape, proxy, relay, summarize, transcribe, or return content from third-party websites or APIs/i);
  assert.doesNotMatch(OPENAI_FIRST_PARTY_SKILL_MD,/read_public_link|read_public_links|get_transcript_result|get_visual_assets|find_in_link/);

  console.log('OpenAI first-party directory surface tests PASS');
}finally{
  await handler.close();
  await pool.end();
}
