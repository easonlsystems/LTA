import assert from 'node:assert/strict';
import {logErrorEvent,logEvent} from '../dist/src/util/log.js';

const emitted=[];
const originalLog=console.log;
const originalError=console.error;
console.log=(...args)=>{emitted.push(args.map(String).join(' '));};
console.error=(...args)=>{emitted.push(args.map(String).join(' '));};

try{
  logEvent('privacy_probe',{
    user_id:'user-secret-123',
    client_id:'client-secret-456',
    job_id:'job-secret-789',
    authorization:'Bearer raw-access-token',
    source_url:'https://private.example/source?id=secret',
    prompt:'private prompt contents',
    message:'provider said private thing',
    email:'person@example.com',
    nested:{url:'https://nested.example/path',email:'nested@example.com',ok:true},
    note:'Bearer another-secret contact note@example.com https://note.example/x',
    safe_count:2
  });
  logErrorEvent(
    'privacy_error',
    new Error('database password=do-not-log https://db.example/internal person2@example.com'),
    {job_id:'job-error-secret',path:'/srv/private/source.txt',safe_flag:true}
  );
}finally{
  console.log=originalLog;
  console.error=originalError;
}

const output=emitted.join('\n');
for(const secret of [
  'user-secret-123','client-secret-456','job-secret-789','raw-access-token',
  'private.example','private prompt contents','provider said private thing','person@example.com',
  'nested.example','nested@example.com','another-secret','note@example.com','note.example',
  'password=do-not-log','db.example','person2@example.com','job-error-secret','/srv/private/source.txt'
]){
  assert.doesNotMatch(output,new RegExp(secret.replace(/[.*+?^$\{\}()|[\]\\]/g,'\\$&'),'i'),`production logs must redact: ${secret}`);
}
assert.match(output,/"safe_count":2/,'non-sensitive aggregate fields should remain observable');
assert.match(output,/"safe_flag":true/,'non-sensitive error context should remain observable');
assert.match(output,/"error_name":"Error"/,'error class may remain for diagnostics');
assert.match(output,/"error_code":"INTERNAL_ERROR"/,'mapped error category may remain for diagnostics');
assert.doesNotMatch(output,/error_message/i,'raw error messages must never be emitted');

console.log('log privacy tests PASS');
