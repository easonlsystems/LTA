import fs from 'node:fs';

function read(path){return fs.readFileSync(path,'utf8');}
function write(path,text){fs.writeFileSync(path,text);}
function replaceOnce(text,needle,replacement,label){
  if(!text.includes(needle))throw new Error(`Missing patch anchor: ${label}`);
  return text.replace(needle,replacement);
}
function replaceRegex(text,re,replacement,label){
  if(!re.test(text))throw new Error(`Missing regex anchor: ${label}`);
  return text.replace(re,replacement);
}

// Runtime YouTube fallback: yt-dlp remains the primary extractor, while the public
// transcript endpoint is a second path for captioned videos that cloud yt-dlp cannot open.
{
  const path='Dockerfile';
  let text=read(path);
  text=replaceOnce(text,
    '"yt-dlp[default,curl-cffi]==2026.8.19" "gallery-dl==1.32.12"',
    '"yt-dlp[default,curl-cffi]==2026.8.19" "gallery-dl==1.32.12" "youtube-transcript-api==1.2.4"',
    'Docker YouTube transcript dependency');
  write(path,text);
}

{
  const path='src/worker/processor.ts';
  let text=read(path);
  text=replaceOnce(text,
    "import { ResolverOrchestrator } from '../resolvers/orchestrator.js';",
    "import { ResolverOrchestrator } from '../resolvers/orchestrator.js';\nimport { resolveYouTubeTranscriptFallback } from '../resolvers/youtubeTranscript.js';\nimport type { MediaMetadata, TranscriptSegment } from '../media/types.js';",
    'processor fallback imports');

  text=replaceOnce(text,
    '    let metadata=await resolver.metadata(parsed);',
`    let directCaption:{language:string;transcript:string;segments:TranscriptSegment[]}|null=null;
    let metadata:MediaMetadata;
    try{
      metadata=await resolver.metadata(parsed);
    }catch(metadataError){
      if(parsed.platform!=='youtube')throw metadataError;
      try{
        const fallback=await resolveYouTubeTranscriptFallback(parsed,job.language,45_000);
        metadata=fallback.metadata;
        directCaption=fallback.caption;
        logEvent('youtube_transcript_fallback_success',{
          job_id:job.id,platform:'youtube',canonical_media_id:metadata.canonicalMediaId,
          duration_seconds:metadata.durationSeconds,language:fallback.caption.language,transport:'youtube_transcript'
        });
      }catch(fallbackError){
        const mapped=asLink2AIError(fallbackError);
        // The fallback can distinguish regional restrictions and cloud-IP blocks that
        // yt-dlp sometimes reports only as the ambiguous "Video unavailable".
        if(['GEO_BLOCKED','PLATFORM_BLOCKED','LOGIN_REQUIRED','MEDIA_NOT_FOUND'].includes(mapped.code))throw mapped;
        throw metadataError;
      }
    }`,
    'processor metadata fallback');

  text=replaceOnce(text,
    '    const caption=await fetchBestCaption(metadata.subtitles,metadata.automaticCaptions,job.language,metadata.originalLanguage);',
    '    const caption=directCaption??await fetchBestCaption(metadata.subtitles,metadata.automaticCaptions,job.language,metadata.originalLanguage);',
    'processor direct caption');
  write(path,text);
}

// Put every currently supported source in the homepage comparison, while keeping
// Reddit gated until approved OAuth credentials are present.
{
  const path='src/api/main.ts';
  let text=read(path);
  const oldTabs=`            <button class="sim-tab" type="button" data-sim-source="reddit"\${redditOAuthReady?'':' hidden'}>\${redditOAuthReady?'Reddit':'Reddit · paused'}</button>\n            <button class="sim-tab active" type="button" data-sim-source="youtube">YouTube</button>\n            <button class="sim-tab" type="button" data-sim-source="github">GitHub</button>\n            <button class="sim-tab" type="button" data-sim-source="pdf">PDF</button>\n            <button class="sim-tab" type="button" data-sim-source="web">Web</button>`;
  const newTabs=`            <button class="sim-tab" type="button" data-sim-source="reddit"\${redditOAuthReady?'':' hidden'}>\${redditOAuthReady?'Reddit':'Reddit · paused'}</button>\n            <button class="sim-tab active" type="button" data-sim-source="youtube">YouTube / Shorts</button>\n            <button class="sim-tab" type="button" data-sim-source="tiktok">TikTok</button>\n            <button class="sim-tab" type="button" data-sim-source="instagram">Instagram</button>\n            <button class="sim-tab" type="button" data-sim-source="x">X</button>\n            <button class="sim-tab" type="button" data-sim-source="bluesky">Bluesky</button>\n            <button class="sim-tab" type="button" data-sim-source="github">GitHub</button>\n            <button class="sim-tab" type="button" data-sim-source="hn">Hacker News</button>\n            <button class="sim-tab" type="button" data-sim-source="pdf">PDF</button>\n            <button class="sim-tab" type="button" data-sim-source="web">Web</button>`;
  text=replaceOnce(text,oldTabs,newTabs,'homepage simulation tabs');

  const demos=`const demos={
        reddit:{name:'Reddit thread',url:'reddit.com/r/ClaudeAI/comments/…',question:'What are people disagreeing about in this Reddit thread?',fail:'I can’t reliably access the contents of that Reddit page. If you paste the content here, I can help.',lead:'The thread splits around where the access failure actually happens.',points:['One group treats Reddit access itself as the blocker.','Another group points to whether the connector is loaded and invoked.','The useful follow-up is separating source availability from tool-selection behavior.']},
        youtube:{name:'YouTube / Shorts',url:'youtube.com/watch?v=…',question:'What is this YouTube video arguing, and what evidence does it use?',fail:'I can see the YouTube URL, but I do not have enough of the video content to summarize its argument reliably.',lead:'The video argues that AI agents are becoming capable faster than the workflows around them are improving.',points:['Coding agents can now complete longer multi-step tasks with less supervision.','Research and tool-use examples show the bottleneck shifting from model capability to the surrounding workflow.','The conclusion argues that better orchestration matters as much as stronger models.']},
        tiktok:{name:'TikTok post',url:'tiktok.com/@creator/video/…',question:'What is this TikTok claiming, and what evidence does the clip actually give?',fail:'I can see the TikTok URL, but I do not have enough of the clip itself to answer from the source reliably.',lead:'The clip makes one central claim and backs it with two concrete examples.',points:['The opening states the claim directly.','The examples support one part of the claim but not every implication.','The ending adds a broader conclusion than the clip fully demonstrates.']},
        instagram:{name:'Instagram post',url:'instagram.com/reel/…',question:'What is this Instagram post claiming, and what details support it?',fail:'I can see the Instagram URL, but the exact post content is not available to me reliably from the link alone.',lead:'The post makes a specific claim and supports it with details from the caption and clip.',points:['The caption gives the central claim.','The media adds one concrete example.','The strongest conclusion goes slightly beyond what is directly shown.']},
        x:{name:'X post',url:'x.com/creator/status/…',question:'What exactly is this post claiming, and what context matters?',fail:'I can see the X URL, but I do not have enough of the exact post content to answer confidently.',lead:'The post makes one direct claim, with context that changes how strongly it should be read.',points:['The wording is narrower than the headline interpretation.','One linked detail supports the factual part of the claim.','The broader conclusion is still the author’s interpretation.']},
        bluesky:{name:'Bluesky post',url:'bsky.app/profile/…/post/…',question:'Summarize this Bluesky post and the context around its claim.',fail:'I can see the Bluesky URL, but I do not have enough exact post content to summarize it reliably.',lead:'The post states a clear position and gives enough surrounding context to explain what it is reacting to.',points:['The main claim is explicit in the post text.','The surrounding context explains what prompted it.','The useful distinction is between the factual event and the author’s judgment.']},
        github:{name:'GitHub issue',url:'github.com/example/project/issues/…',question:'Review this GitHub issue and suggest the next fix to try.',fail:'I can’t reliably inspect the full Issue thread from the URL alone. Paste the Issue body and comments and I can review it.',lead:'The Issue points to one likely failure path and one missing diagnostic.',points:['The report is reproducible only after reconnecting.','Comments narrow the failure to state carried between requests.','The next useful step is instrumenting the reconnect path before changing behavior.']},
        hn:{name:'Hacker News discussion',url:'news.ycombinator.com/item?id=…',question:'Where do commenters in this Hacker News discussion actually disagree?',fail:'I can open the story, but I do not have enough of the discussion thread to summarize the disagreement reliably.',lead:'The discussion splits into a few recurring arguments rather than one consensus.',points:['One group accepts the article’s central premise.','Another challenges whether the evidence supports that conclusion.','A third group focuses on practical consequences instead of the original claim.']},
        pdf:{name:'Public PDF',url:'example.org/research-paper.pdf',question:'What are the paper’s main findings and biggest limitation?',fail:'This fetch did not expose enough of the PDF text to answer from the document itself.',lead:'The paper reports a clear result, but the strongest limitation is in how broadly it can be generalized.',points:['The central finding is consistent across the reported experiments.','The evidence is strongest inside the study’s measured setting.','The paper itself leaves external validity as the main caution.']},
        web:{name:'Public webpage',url:'example.org/article',question:'Summarize this article and separate evidence from opinion.',fail:'This fetch did not expose enough of the exact page content to separate its evidence from opinion reliably.',lead:'The article mixes reported facts with the author’s interpretation.',points:['The factual section relies on named events and published figures.','The analysis section makes a broader causal claim.','The conclusion is more confident than the evidence shown earlier.']}
      };`;
  text=replaceRegex(text,/const demos=\{[\s\S]*?\n      \};(?=\n      const sourceExplore=)/,demos,'homepage demos');

  for(const key of ['x','instagram','tiktok','hn','bluesky']){
    const re=new RegExp(`(${key}:\\{[^}]*?)sim:null`);
    text=replaceRegex(text,re,`$1sim:'${key}'`,`source explorer ${key} simulation`);
  }
  write(path,text);
}

{
  const path='test/runtime-smoke.mjs';
  let text=read(path);
  text=replaceOnce(text,
    "const simTabs=['reddit','youtube','github','pdf','web'].map(value=>new FakeElement('',{simSource:value}));",
    "const simTabs=['reddit','youtube','tiktok','instagram','x','bluesky','github','hn','pdf','web'].map(value=>new FakeElement('',{simSource:value}));\n  const simTab=(key)=>{const tab=simTabs.find(el=>el.dataset.simSource===key);assert.ok(tab,`missing simulation tab ${key}`);return tab;};",
    'runtime simulation source list');
  text=text.replaceAll('simTabs[0]',"simTab('reddit')");
  text=text.replaceAll('simTabs[1]',"simTab('youtube')");
  text=text.replaceAll('simTabs[2]',"simTab('github')");

  text=replaceOnce(text,
    "      assert.match(body,/See the difference/);",
    "      assert.match(body,/See the difference/);\n      for(const source of ['youtube','tiktok','instagram','x','bluesky','github','hn','pdf','web'])assert.match(body,new RegExp(`data-sim-source=\\\"${source}\\\"`),`homepage should expose ${source} simulation`);",
    'runtime homepage source assertions');

  text=replaceOnce(text,
    "  assert.equal(ids['sim-run'].textContent,'See the difference →','Reset should restore the initial comparison CTA');",
    `  assert.equal(ids['sim-run'].textContent,'See the difference →','Reset should restore the initial comparison CTA');
  // Every advertised supported source must have a runnable comparison, not a dead tab.
  for(const source of ['tiktok','instagram','x','bluesky','hn','pdf','web']){
    simTab(source).listeners.click();
    assert.equal(ids['sim-left-state'].textContent,'Ready',source+' should initialize left side as Ready');
    assert.equal(ids['sim-right-state'].textContent,'Ready',source+' should initialize right side as Ready');
    ids['sim-run'].listeners.click();
    runAllTimers();
    assert.equal(ids['sim-right-state'].textContent,'Source loaded',source+' comparison should load the Link2AI side');
    assert.ok(ids['sim-right-answer'].classList.contains('show'),source+' comparison should reveal an answer');
    ids['sim-reset'].listeners.click();
  }`,
    'runtime all-source simulation loop');
  write(path,text);
}

console.log('V2 YouTube fallback + homepage source simulation patch applied');
