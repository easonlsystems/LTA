import assert from 'node:assert/strict';

process.env.NODE_ENV='production';
process.env.DATABASE_URL='postgres://127.0.0.1:1/link2ai';
process.env.PUBLIC_BASE_URL='https://link2ai.example';
process.env.PUBLIC_BRAND_NAME='Link2AI';
process.env.APP_SECRET='01234567890123456789012345678901';

const auth=await import('../dist/src/auth/service.js');

const session='session-token-for-security-test-abcdefghijklmnopqrstuvwxyz';
const sessionCookie=`${auth.sessionCookieName()}=${encodeURIComponent(session)}`;
const setCookie=auth.createFounderStepUpCookie(sessionCookie,900);
assert.ok(setCookie,'step-up cookie should be issued when a web session exists');
assert.match(setCookie,/HttpOnly/);
assert.match(setCookie,/SameSite=Strict/);
assert.match(setCookie,/Path=\/;/,'step-up cookie must be visible to both /founder and /admin');
assert.match(setCookie,/Secure/);
assert.doesNotMatch(setCookie,/Path=\/founder/,'admin bootstrap cannot use a /founder-only cookie');
const stepupPair=setCookie.split(';')[0];
assert.equal(auth.hasFounderStepUp(`${sessionCookie}; ${stepupPair}`),true,'step-up cookie should validate for the session it was issued to');
assert.equal(auth.hasFounderStepUp(`${auth.sessionCookieName()}=different-session; ${stepupPair}`),false,'step-up cookie must be bound to the original session');
assert.equal(auth.hasFounderStepUp(sessionCookie),false,'regular login alone must not unlock founder routes');
const csrf=auth.csrfTokenFromSessionCookie(sessionCookie);
assert.ok(csrf);
assert.equal(auth.verifyCsrfToken(sessionCookie,csrf),true);
assert.equal(auth.verifyCsrfToken(sessionCookie,'00'.repeat(32)),false);
const clearStepup=auth.clearFounderStepUpCookie();
assert.match(clearStepup,/Max-Age=0/);
assert.match(clearStepup,/Path=\/;/,'step-up clear cookie must use the same root path');
assert.match(clearStepup,/HttpOnly/);
assert.match(clearStepup,/SameSite=Strict/);
assert.match(clearStepup,/Secure/);
const otpHash=auth.founderStepUpChallengeHash('00000000-0000-4000-8000-000000000001',sessionCookie,'123456');
assert.ok(otpHash,'founder OTP hash should require a valid web session cookie');
assert.notEqual(otpHash,auth.founderStepUpChallengeHash('00000000-0000-4000-8000-000000000001',`${auth.sessionCookieName()}=different-session`,'123456'),'founder OTP must be bound to the current session');
assert.notEqual(otpHash,auth.founderStepUpChallengeHash('00000000-0000-4000-8000-000000000002',sessionCookie,'123456'),'founder OTP must be bound to the founder user');
assert.notEqual(otpHash,auth.founderStepUpChallengeHash('00000000-0000-4000-8000-000000000001',sessionCookie,'654321'),'different OTP codes must hash differently');
assert.equal(auth.founderStepUpChallengeHash('00000000-0000-4000-8000-000000000001',undefined,'123456'),null,'founder OTP must not work without a session');

const publicUrl=await import('../dist/src/config/publicUrl.js');
assert.equal(publicUrl.browserSameOriginOk({host:'live.example',origin:'https://live.example'},'https://configured.example',true),true,'browser origin should match the actual serving host, not a stale configured base URL');
assert.equal(publicUrl.browserSameOriginOk({host:'internal.railway.local',origin:'https://configured.example'},'https://configured.example',true),true,'canonical public origin must remain valid behind a reverse proxy whose backend Host differs');
assert.equal(publicUrl.browserSameOriginOk({host:'live.example',origin:'https://evil.example'},'https://configured.example',true),false,'cross-site origin must be rejected');
assert.equal(publicUrl.browserSameOriginOk({host:'live.example',origin:'null','sec-fetch-site':'same-origin'},'https://configured.example',true),true,'opaque origin from a browser-classified same-origin request may proceed to CSRF validation');
assert.equal(publicUrl.browserSameOriginOk({host:'live.example',origin:'null','sec-fetch-site':'cross-site'},'https://configured.example',true),false,'cross-site opaque origin must be rejected');
assert.equal(publicUrl.browserSameOriginOk({host:'live.example','sec-fetch-site':'same-origin'},'https://configured.example',true),true,'same-origin Fetch Metadata may safely cover a suppressed Origin/Referer when CSRF is also required');
assert.equal(publicUrl.browserSameOriginOk({host:'live.example','sec-fetch-site':'cross-site'},'https://configured.example',true),false,'cross-site Fetch Metadata must be rejected');
assert.equal(publicUrl.browserSameOriginOk({host:'live.example',referer:'https://live.example/founder'},'https://configured.example',true),true,'same-host referer fallback should be accepted');

const safeHttp=await import('../dist/src/util/safeHttp.js');
assert.deepEqual(
  safeHttp.orderPublicAddresses([{address:'2001:4860:4860::8888',family:6},{address:'8.8.8.8',family:4}]),
  [{address:'8.8.8.8',family:4},{address:'2001:4860:4860::8888',family:6}],
  'external HTTP should prefer IPv4 while retaining IPv6 fallback'
);
const {videoCompleteness}=await import('../dist/src/worker/processor.js');
assert.equal(videoCompleteness('partial captions',600,[{end:10}]).truncated,true,'short caption timelines must be disclosed as partial');
assert.equal(videoCompleteness('complete captions',600,[{end:595}]).truncated,false,'near-complete caption timelines must not be marked partial');
console.log('security tests PASS');
