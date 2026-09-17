import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const admin=await readFile('src/admin/routes.ts','utf8');
const wrapper=await readFile('src/auth/routes.ts','utf8');
const sql=await readFile('sql/003_admin_passkeys.sql','utf8');
const pkg=JSON.parse(await readFile('package.json','utf8'));

assert.equal(pkg.dependencies['@simplewebauthn/server'],'14.0.2');
assert.equal(pkg.dependencies['@simplewebauthn/browser'],'14.0.2');
assert.match(wrapper,/registerBaseAuthRoutes/);
assert.match(wrapper,/registerAdminRoutes/);
assert.match(admin,/generateAuthenticationOptions/);
assert.match(admin,/verifyAuthenticationResponse/);
assert.match(admin,/generateRegistrationOptions/);
assert.match(admin,/verifyRegistrationResponse/);
assert.match(admin,/userVerification:'required'/);
assert.match(admin,/requireUserVerification:true/);
assert.match(admin,/SameSite=Strict/);
assert.match(admin,/Passkey protected/);
assert.match(admin,/founder_recovery_codes/);
assert.match(admin,/The final passkey cannot be removed/);
assert.match(admin,/cache:'no-store'/);
assert.match(sql,/CREATE TABLE IF NOT EXISTS founder_passkeys/);
assert.match(sql,/CREATE TABLE IF NOT EXISTS founder_webauthn_challenges/);
assert.match(sql,/CREATE TABLE IF NOT EXISTS founder_recovery_codes/);
assert.match(sql,/block_founder_email_stepup_after_passkey/);
assert.match(sql,/Founder audit history is append-only/);
assert.match(sql,/chain_founder_admin_event/);

console.log('admin passkey schema: ok');
