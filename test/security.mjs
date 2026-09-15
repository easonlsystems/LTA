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
assert.match(setCookie,/Path=\/founder/);
assert.match(setCookie,/Secure/);
const stepupPair=setCookie.split(';')[0];
assert.equal(auth.hasFounderStepUp(`${sessionCookie}; ${stepupPair}`),true,'step-up cookie should validate for the session it was issued to');
assert.equal(auth.hasFounderStepUp(`${auth.sessionCookieName()}=different-session; ${stepupPair}`),false,'step-up cookie must be bound to the original session');
assert.equal(auth.hasFounderStepUp(sessionCookie),false,'regular login alone must not unlock founder routes');
const csrf=auth.csrfTokenFromSessionCookie(sessionCookie);
assert.ok(csrf);
assert.equal(auth.verifyCsrfToken(sessionCookie,csrf),true);
assert.equal(auth.verifyCsrfToken(sessionCookie,'00'.repeat(32)),false);
assert.match(auth.clearFounderStepUpCookie(),/Max-Age=0/);
console.log('security tests PASS');
