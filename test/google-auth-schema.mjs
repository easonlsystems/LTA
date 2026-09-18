import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const envSource=await readFile('src/config/env.ts','utf8');
const authSource=await readFile('src/auth/service.ts','utf8');
const routes=await readFile('src/auth/routes.base.ts','utf8');
const sql=await readFile('sql/005_google_signin.sql','utf8');

assert.match(envSource,/GOOGLE_CLIENT_ID/);
assert.match(envSource,/GOOGLE_CLIENT_SECRET/);
assert.match(authSource,/googleSignInConfigured/);
assert.match(authSource,/beginGoogleSignIn/);
assert.match(authSource,/completeGoogleSignIn/);
assert.match(authSource,/accounts\.google\.com\/o\/oauth2\/v2\/auth/);
assert.match(authSource,/oauth2\.googleapis\.com\/token/);
assert.match(authSource,/openidconnect\.googleapis\.com\/v1\/userinfo/);
assert.match(authSource,/code_challenge_method','S256'/);
assert.match(authSource,/email_verified!==true/,'Google email must be verified before account linking');
assert.match(authSource,/WHERE google_sub=\$1 FOR UPDATE/,'Google stable subject must be the primary identity key');
assert.match(authSource,/WHERE lower\(email\)=lower\(\$1\) FOR UPDATE/,'Verified Google email must reconnect an existing Link2AI account');
assert.match(authSource,/currentUserId/,'anonymous trial account should be preserved when possible');

assert.match(routes,/Continue with Google/);
assert.match(routes,/Link2AI never sees or stores your Google password/);
assert.match(routes,/SameSite=Lax/);
assert.match(routes,/Path=\/auth\/google\/callback/);
assert.match(routes,/googleSignInConfigured\(\)\)return reply\.code\(404\)/,'legacy password/email-code endpoints must close when Google is configured');

assert.match(sql,/ADD COLUMN IF NOT EXISTS google_sub text/);
assert.match(sql,/users_google_sub_unique_idx/);
assert.match(sql,/CREATE TABLE IF NOT EXISTS google_oauth_flows/);
assert.match(sql,/state_hash text NOT NULL UNIQUE/);
assert.match(sql,/consumed_at timestamptz/);

console.log('google auth schema tests PASS');
