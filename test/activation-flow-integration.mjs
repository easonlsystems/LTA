import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import Fastify from 'fastify';

Object.assign(process.env,{
  NODE_ENV:'test',
  DATABASE_URL:process.env.DATABASE_URL||'postgres://postgres:postgres@127.0.0.1:5432/link2ai_test',
  PUBLIC_BASE_URL:'https://lta.test',
  PUBLIC_BRAND_NAME:'LTA',
  APP_SECRET:'activation-flow-test-secret-0123456789abcdef',
  MCP_INLINE_WAIT_MS:'1000'
});

const [
  {pool},
  {trackWebsiteVisit,trackWebsiteEvent,linkWebsiteVisitorToUser},
  {registerPasswordAccount,sessionCookieName,csrfTokenFromSessionCookie,mcpResource},
  {registerAuthRoutes},
  {parseAllowedMediaUrl},
  {startTranscriptJob}
]=await Promise.all([
  import('../dist/src/db/pool.js'),
  import('../dist/src/analytics/visitors.js'),
  import('../dist/src/auth/service.js'),
  import('../dist/src/auth/routes.base.js'),
  import('../dist/src/source/policy.js'),
  import('../dist/src/source/service.js')
]);

const app=Fastify();
await registerAuthRoutes(app);

function pkceChallenge(verifier){
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function cookiePair(setCookie){
  return String(setCookie||'').split(';')[0];
}

async function seedCompletedSource(userId,url,contentText){
  const parsed=parseAllowedMediaUrl(url,'default');
  const cache=await pool.query(
    `INSERT INTO transcript_cache(
       platform,canonical_media_id,language,title,creator,caption,duration_seconds,
       transcript,segments,source,expires_at,truncated,extracted_token_estimate,usage_units
     )
     VALUES($1,$2,'und',$3,'Fixture',NULL,0,$4,'[]'::jsonb,'page',now()+interval '1 hour',false,20,1)
     RETURNING id`,
    [parsed.platform,parsed.canonicalMediaId,'Fixture source',contentText]
  );
  await pool.query(
    `INSERT INTO transcript_jobs(
       user_id,platform,source_url,normalized_url,canonical_media_id,language,status,
       priority,client_source,transcript_cache_id,duration_seconds,completed_at
     )
     VALUES($1,$2,$3,$4,$5,'auto','completed',0,'claude',$6,0,now())`,
    [userId,parsed.platform,parsed.sourceUrl,parsed.normalizedUrl,parsed.canonicalMediaId,cache.rows[0].id]
  );
  return parsed;
}

async function seedQuotaBlockedSource(userId,url,requiredUnits){
  const parsed=parseAllowedMediaUrl(url,'default');
  await pool.query(
    `INSERT INTO transcript_jobs(
       user_id,platform,source_url,normalized_url,canonical_media_id,language,status,
       priority,client_source,error_code,error_message,retryable,required_usage_units
     )
     VALUES($1,$2,$3,$4,$5,'auto','awaiting_payment',0,'claude','QUOTA_EXCEEDED',
       'Not enough processing units.',false,$6)`,
    [userId,parsed.platform,parsed.sourceUrl,parsed.normalizedUrl,parsed.canonicalMediaId,requiredUnits]
  );
  return parsed;
}

try{
  // Flow B starts first so the anonymous campaign touch is the source of truth.
  const responseHeaders={};
  const landingReq={
    url:'/?utm_source=x&utm_campaign=sherwin&utm_content=batch1_post',
    headers:{'user-agent':'Mozilla/5.0 activation-flow','referer':'https://x.com/'}
  };
  const fakeReply={header(name,value){responseHeaders[String(name).toLowerCase()]=value;return this;}};
  await trackWebsiteVisit(landingReq,fakeReply,'/');
  const visitorCookie=cookiePair(responseHeaders['set-cookie']);
  assert.match(visitorCookie,/^link2ai_visitor=/);

  const anonymousReq={headers:{cookie:visitorCookie,'user-agent':'Mozilla/5.0 activation-flow'}};
  await trackWebsiteEvent(anonymousReq,'landing_view','/');
  await trackWebsiteEvent(anonymousReq,'add_lta_click','/',{from:'hero'});

  const account=await registerPasswordAccount(
    'activation-flow@example.com',
    'activation-flow-password-123',
    '/connect'
  );
  await linkWebsiteVisitorToUser(visitorCookie,account.user.id,true);
  const sessionCookie=`${sessionCookieName()}=${encodeURIComponent(account.sessionToken)}`;
  const cookies=`${visitorCookie}; ${sessionCookie}`;

  const registration=await app.inject({
    method:'POST',url:'/oauth/register',
    payload:{client_name:'Activation Flow Client',redirect_uris:['https://client.test/callback']}
  });
  assert.equal(registration.statusCode,201,registration.body);
  const clientId=registration.json().client_id;
  assert.ok(clientId);

  const verifier='activation-flow-verifier-abcdefghijklmnopqrstuvwxyz0123456789ABCDE';
  assert.ok(verifier.length>=43&&verifier.length<=128);
  const authorizeFields={
    response_type:'code',
    client_id:clientId,
    redirect_uri:'https://client.test/callback',
    scope:'link2ai:read',
    resource:mcpResource(),
    code_challenge:pkceChallenge(verifier),
    code_challenge_method:'S256',
    state:'activation-flow-state'
  };
  const authorizeQuery=new URLSearchParams(authorizeFields).toString();
  const authorizePage=await app.inject({
    method:'GET',
    url:`/oauth/authorize?${authorizeQuery}`,
    headers:{cookie:cookies,'user-agent':'Mozilla/5.0 activation-flow'}
  });
  assert.equal(authorizePage.statusCode,200,authorizePage.body);
  const csrf=csrfTokenFromSessionCookie(cookies);
  assert.ok(csrf);

  const authorizePost=await app.inject({
    method:'POST',url:'/oauth/authorize',
    headers:{cookie:cookies,'user-agent':'Mozilla/5.0 activation-flow'},
    payload:{...authorizeFields,csrf}
  });
  assert.equal(authorizePost.statusCode,302,authorizePost.body);
  const callback=new URL(authorizePost.headers.location);
  const code=callback.searchParams.get('code');
  assert.ok(code);

  const token=await app.inject({
    method:'POST',url:'/oauth/token',
    headers:{'user-agent':'activation-flow-client/1.0'},
    payload:{
      grant_type:'authorization_code',
      code,
      client_id:clientId,
      redirect_uri:'https://client.test/callback',
      code_verifier:verifier,
      resource:mcpResource()
    }
  });
  assert.equal(token.statusCode,200,token.body);
  assert.ok(token.json().access_token);

  const sourceOne='https://example.com/lta-activation-one';
  const sourceTwo='https://example.org/lta-activation-two';
  await seedCompletedSource(account.user.id,sourceOne,'First fixture source content for activation flow.');
  await seedCompletedSource(account.user.id,sourceTwo,'Second distinct fixture source content for activation flow.');

  const first=await startTranscriptJob(account.user.id,sourceOne,{clientSource:'claude'});
  assert.equal(first.status,'completed');
  assert.equal(first.message,'Source ready. Try another link.');

  const sameAgain=await startTranscriptJob(account.user.id,sourceOne,{clientSource:'claude'});
  assert.equal(sameAgain.status,'completed');
  const prematureSecond=await pool.query(
    `SELECT COUNT(*)::int AS count FROM product_activation_events
     WHERE user_id=$1 AND event_name='second_read_success'`,
    [account.user.id]
  );
  assert.equal(prematureSecond.rows[0].count,0,'same-source follow-up must not count as second successful source');

  const second=await startTranscriptJob(account.user.id,sourceTwo,{clientSource:'claude'});
  assert.equal(second.status,'completed');

  const canonicalEvents=await pool.query(
    `SELECT event_name,utm_source,utm_campaign,utm_content
     FROM product_activation_events
     WHERE user_id=$1 AND event_name IN (
       'oauth_start','oauth_success','connector_connected',
       'read_requested','first_read_success','second_read_success'
     )
     ORDER BY created_at`,
    [account.user.id]
  );
  const names=canonicalEvents.rows.map(row=>row.event_name);
  for(const required of ['oauth_start','oauth_success','connector_connected','read_requested','first_read_success','second_read_success']){
    assert.ok(names.includes(required),`missing ${required}`);
  }
  const secondCount=canonicalEvents.rows.filter(row=>row.event_name==='second_read_success').length;
  assert.equal(secondCount,1);
  for(const row of canonicalEvents.rows.filter(row=>['oauth_start','oauth_success','connector_connected','first_read_success','second_read_success'].includes(row.event_name))){
    assert.equal(row.utm_source,'x');
    assert.equal(row.utm_campaign,'sherwin');
    assert.equal(row.utm_content,'batch1_post');
  }

  const website=await pool.query(
    `SELECT event_name,user_id,utm_source,utm_campaign,utm_content
     FROM website_events
     WHERE event_name IN ('landing_view','add_lta_click')
     ORDER BY created_at`
  );
  assert.equal(website.rowCount,2);
  for(const row of website.rows){
    assert.equal(row.user_id,account.user.id,'anonymous website event must link to signed-in user');
    assert.equal(row.utm_source,'x');
    assert.equal(row.utm_campaign,'sherwin');
    assert.equal(row.utm_content,'batch1_post');
  }

  const accessRows=await pool.query(
    `SELECT source_key,outcome,error_code,processing_time_ms,cache_hit,units_charged,units_refunded
     FROM source_access_events
     WHERE user_id=$1 AND outcome='completed'
     ORDER BY created_at`,
    [account.user.id]
  );
  assert.ok(accessRows.rowCount>=3);
  assert.equal(new Set(accessRows.rows.map(row=>row.source_key)).size,2);
  assert.ok(accessRows.rows.every(row=>row.processing_time_ms!==null));
  assert.ok(accessRows.rows.every(row=>row.units_charged===0));
  assert.ok(accessRows.rows.every(row=>row.units_refunded===0));

  console.log('FLOW_A PASS new visitor → OAuth connected → first read → same-source follow-up ignored → second distinct read');
  console.log('FLOW_B PASS X/Sherwin UTM → anonymous landing/click → OAuth → first/second read attribution preserved');

  const quotaUrl='https://example.net/lta-quota-blocked';
  await seedQuotaBlockedSource(account.user.id,quotaUrl,11);
  const beforeLedger=await pool.query(
    'SELECT COALESCE(SUM(seconds),0)::int AS seconds FROM usage_ledger WHERE user_id=$1',
    [account.user.id]
  );
  const blocked=await startTranscriptJob(account.user.id,quotaUrl,{clientSource:'claude'});
  assert.equal(blocked.status,'payment_required');
  assert.equal(blocked.error_code,'QUOTA_EXCEEDED');
  assert.equal(blocked.usage_units,0);
  assert.equal(blocked.remaining_usage_units,10);
  assert.equal(blocked.required_usage_units,11);
  assert.equal(blocked.topup_path,'/account');
  assert.match(blocked.message,/This attempt used 0 units/);
  assert.match(blocked.message,/Open LTA → Account/);

  const afterLedger=await pool.query(
    'SELECT COALESCE(SUM(seconds),0)::int AS seconds FROM usage_ledger WHERE user_id=$1',
    [account.user.id]
  );
  assert.equal(afterLedger.rows[0].seconds,beforeLedger.rows[0].seconds,'quota-blocked read must not charge');

  const quotaAccess=await pool.query(
    `SELECT outcome,error_code,units_charged,units_refunded
     FROM source_access_events
     WHERE user_id=$1 AND outcome='quota_exceeded'
     ORDER BY created_at DESC LIMIT 1`,
    [account.user.id]
  );
  assert.equal(quotaAccess.rowCount,1);
  assert.equal(quotaAccess.rows[0].error_code,'QUOTA_EXCEEDED');
  assert.equal(quotaAccess.rows[0].units_charged,0);

  const quotaEvent=await pool.query(
    `SELECT metadata FROM product_activation_events
     WHERE user_id=$1 AND event_name='quota_exceeded'
     ORDER BY created_at DESC LIMIT 1`,
    [account.user.id]
  );
  assert.equal(quotaEvent.rowCount,1);
  assert.equal(quotaEvent.rows[0].metadata.units_charged,0);

  console.log('FLOW_C PASS insufficient quota → blocked cleanly → 0 charge → remaining/required units + /account recovery path');
}finally{
  await app.close();
  await pool.end();
}
