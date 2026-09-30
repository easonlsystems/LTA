import assert from 'node:assert/strict';
import {parseMediaUrl} from '../dist/src/media/url.js';
import {OPENAI_GITHUB_LICENSE_ALLOWLIST,openAiGitHubLicenseEvidence} from '../dist/src/source/openaiRights.js';

assert.deepEqual([...OPENAI_GITHUB_LICENSE_ALLOWLIST].sort(),['0BSD','CC0-1.0','Unlicense'].sort());

const input=parseMediaUrl('https://github.com/gnembon/scarpet/issues/408');
for(const spdx of ['CC0-1.0','0BSD','Unlicense']){
  const evidence=openAiGitHubLicenseEvidence(input,{license:{spdx_id:spdx}});
  assert.equal(evidence.platform,'github');
  assert.equal(evidence.repository,'gnembon/scarpet');
  assert.equal(evidence.spdxId,spdx);
}

for(const payload of [
  {license:{spdx_id:'MIT'}},
  {license:{spdx_id:'Apache-2.0'}},
  {license:{spdx_id:'NOASSERTION'}},
  {license:null},
  {}
]){
  assert.throws(
    ()=>openAiGitHubLicenseEvidence(input,payload),
    error=>error?.code==='PLATFORM_BLOCKED'&&error?.details?.cause_code==='openai_source_rights_not_verified'
  );
}

const nonGitHub=parseMediaUrl('https://news.ycombinator.com/item?id=8863');
assert.throws(
  ()=>openAiGitHubLicenseEvidence(nonGitHub,{license:{spdx_id:'CC0-1.0'}}),
  error=>error?.code==='PLATFORM_BLOCKED'&&error?.details?.cause_code==='openai_source_not_authorized'
);

console.log('OpenAI GitHub rights evidence tests PASS');
