import assert from 'node:assert/strict';
import { generalAudienceBlockReason } from '../dist/src/safety/generalAudience.js';

assert.equal(
  generalAudienceBlockReason({title:'News report on pornography policy and online safety',text:'A policy article discussing regulation and child safety.'}),
  null,
  'General-audience discussion about adult-content policy must not be blocked just for mentioning the topic.'
);

assert.equal(
  generalAudienceBlockReason({title:'Sex education and consent for teenagers',text:'Educational health information about consent and relationships.'}),
  null,
  'Educational sexual-health content must remain available.'
);

assert.equal(generalAudienceBlockReason({sourceUrl:'https://www.pornhub.com/view_video.php?viewkey=abc'}),'adult_content_domain');
assert.equal(generalAudienceBlockReason({title:'18+ adults only'}),'adult_only_label');
assert.equal(generalAudienceBlockReason({ageLimit:18}),'age_restricted_source');
assert.equal(generalAudienceBlockReason({sensitive:true}),'platform_sensitive_media');
assert.equal(generalAudienceBlockReason({title:'Free porn video stream'}),'explicit_sexual_content');
assert.equal(generalAudienceBlockReason({text:'這是一段成人影片與色情直播內容'}),'explicit_sexual_content');

console.log('General-audience safety tests PASS');
