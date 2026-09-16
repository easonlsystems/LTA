import assert from 'node:assert/strict';

process.env.DATABASE_URL='postgres://127.0.0.1:1/link2ai';
process.env.PUBLIC_BASE_URL='http://localhost:3000';
process.env.APP_SECRET='01234567890123456789012345678901';
process.env.PUBLIC_BRAND_NAME='LaunchBrand';

const [{createMcpHandler},{buildMcpServer},{pool}]=await Promise.all([
  import('@modelcontextprotocol/server'),
  import('../dist/src/mcp/server.js'),
  import('../dist/src/db/pool.js')
]);

const handler=createMcpHandler(buildMcpServer);
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

try{
  const initialized=await call({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'audit',version:'1'}}});
  assert.equal(initialized.result.serverInfo.name,'LaunchBrand');

  const listed=await call({jsonrpc:'2.0',id:2,method:'tools/list',params:{}});
  assert.deepEqual(listed.result.tools.map(tool=>tool.name),['get_video_transcript','get_transcript_result','get_usage']);
  assert.match(listed.result.tools[0].description,/LaunchBrand/);
  assert.match(listed.result.tools[1].description,/LaunchBrand/);
  assert.doesNotMatch(JSON.stringify(listed.result.tools),/\$\{env\(\)/);
  assert.deepEqual(listed.result.tools[0].annotations,{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:true});
  assert.equal(listed.result.tools[1].annotations.readOnlyHint,true);
  assert.equal(listed.result.tools[2].annotations.readOnlyHint,true);

  // Assertions for the production selection contract: use Link2AI when the user's
  // question actually depends on supported link contents, while avoiding unrelated URLs.
  const get_video_transcript_desc=listed.result.tools[0].description;
  assert.match(get_video_transcript_desc,/request depends on reading or analyzing the contents of a supported public link/i,'Description must tell Claude when Link2AI is the relevant reader');
  assert.match(get_video_transcript_desc,/load\/call Link2AI rather than assuming the link is inaccessible/i,'Description must prefer Link2AI when supported source content is required');
  assert.match(get_video_transcript_desc,/Do not use it for unrelated URLs/i,'Description must still reject unrelated URL use');
  assert.match(get_video_transcript_desc,/Reddit/i,'Description must advertise Reddit post support');

  // Assertion for explicit opt-out wording
  assert.match(get_video_transcript_desc,/explicitly.*(?:request|requests).*NOT.*(?:use|call)|(?:user|user's).*explicitly.*(?:avoid|not|don't).*(?:fetch|external)/i,'Description must respect explicit user request not to use the tool');

  const failed=await call({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'get_usage',arguments:{}}});
  assert.equal(failed.result.isError,true);
  const payload=JSON.parse(failed.result.content[0].text.split('\n').at(-1));
  assert.equal(payload.error_code,'INTERNAL_ERROR');
  assert.equal(payload.message,'The service hit an internal error while processing this link.');
  assert.doesNotMatch(failed.result.content[0].text,/ECONNREFUSED|127\.0\.0\.1|postgres/i);
  console.log('MCP smoke tests PASS');
}finally{
  await handler.close();
  await pool.end();
}

