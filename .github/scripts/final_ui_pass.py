from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly 1 match, found {count}")
    return text.replace(old, new, 1)

main_path = Path('src/api/main.ts')
main = main_path.read_text()

# Give public pages a route hook so desktop composition can be tuned without
# leaking those rules into founder/admin surfaces.
main = replace_once(
    main,
    '<style>${siteCss}</style></head><body><a class="skip-link"',
    '<style>${siteCss}</style></head><body data-path="${path}"><a class="skip-link"',
    'siteShell body route hook',
)

# Keep the navigation visually integrated at the top, but make it readable once
# content scrolls underneath it.
main = replace_once(
    main,
    '</div></nav>${body}<footer>',
    '''</div></nav><script>(()=>{const n=document.querySelector('nav');if(!n)return;const sync=()=>n.classList.toggle('scrolled',window.scrollY>10);sync();window.addEventListener('scroll',sync,{passive:true});})();</script>${body}<footer>''',
    'siteShell nav scroll behavior',
)

# Homepage proof: keep initial CTA, make the completed state actionable, remove
# redundant tool-state pills, and make the YouTube answer sound source-specific.
main = replace_once(
    main,
    "youtube:{name:'YouTube video',url:'youtube.com/watch?v=…',question:'What is this YouTube video arguing, and what evidence does it use?',fail:'I can see the YouTube URL, but I do not have enough of the video content to summarize its argument reliably.',lead:'The video builds one main claim through three supporting points.',points:['The opening frames the problem and the creator’s thesis.','The middle section gives examples and counterarguments.','The conclusion narrows the claim and leaves one unresolved assumption.']}",
    "youtube:{name:'YouTube video',url:'youtube.com/watch?v=…',question:'What is this YouTube video arguing, and what evidence does it use?',fail:'I can see the YouTube URL, but I do not have enough of the video content to summarize its argument reliably.',lead:'The video argues that AI agents are becoming capable faster than the workflows around them are improving.',points:['Coding agents can now complete longer multi-step tasks with less supervision.','Research and tool-use examples show the bottleneck shifting from model capability to the surrounding workflow.','The conclusion argues that better orchestration matters as much as stronger models.']}",
    'source-specific YouTube demo',
)
main = replace_once(
    main,
    '<div class="sim-tool" id="sim-tool">Link2AI · Reading source… <i>connected</i></div>',
    '<div class="sim-tool" id="sim-tool">Link2AI · Reading source…</div>',
    'static tool label',
)
main = replace_once(
    main,
    "q('#sim-tool').innerHTML='Link2AI · Reading source… <i>connected</i>';q('#sim-conclusion').classList.remove('show');",
    "q('#sim-tool').innerHTML='Link2AI · Reading source…';q('#sim-run').textContent='See the difference →';q('#sim-run').disabled=false;q('#sim-conclusion').classList.remove('show');",
    'reset comparison button and tool label',
)
main = replace_once(
    main,
    "const renderAnswer=(el,lead,points)=>{el.innerHTML='<span class=\\\"sim-chat-speaker\\\">Claude</span><strong>'+lead+'</strong><p>'+points[0]+'</p>';};",
    "const renderAnswer=(el,lead,points)=>{el.innerHTML='<span class=\\\"sim-chat-speaker\\\">Claude</span><strong>'+lead+'</strong><ul>'+points.slice(0,2).map(point=>'<li>'+point+'</li>').join('')+'</ul>';};",
    'concise source-specific answer renderer',
)
main = replace_once(
    main,
    "const t=reduced?0:1;q('#sim-left-state').textContent='Trying source';",
    "const t=reduced?0:1;q('#sim-run').textContent='Comparing…';q('#sim-run').disabled=true;q('#sim-left-state').textContent='Trying source';",
    'comparison running state',
)
main = replace_once(
    main,
    "q('#sim-tool').innerHTML='Link2AI · Source loaded <i>ready</i>';q('#sim-right-state').textContent='Source loaded';",
    "q('#sim-tool').innerHTML='Link2AI · Source loaded';q('#sim-right-state').textContent='Source loaded';",
    'remove redundant ready state',
)
main = replace_once(
    main,
    "setTimer(()=>{q('#sim-conclusion').hidden=false;q('#sim-conclusion').classList.add('show');},2150*t,runId);",
    "setTimer(()=>{q('#sim-conclusion').hidden=false;q('#sim-conclusion').classList.add('show');q('#sim-run').textContent='Run again ↻';q('#sim-run').disabled=false;},2150*t,runId);",
    'completed comparison CTA',
)

# Tighten support copy without adding new claims; preserve every important safety
# and billing boundary while making the cards scan rather than read like walls.
main = replace_once(
    main,
    'Reconnect from the setup page, open Claude’s Connectors Directory, search for Link2AI, and finish authorization. For maximum reliability in a conversation, set Tool access to Always available.',
    'Reconnect from the setup page, finish Claude authorization, then set Tool access to Always available for the conversation.',
    'support connection copy',
)
main = replace_once(
    main,
    'Confirm it is an individual supported public link, not a profile, feed, search page, private item, paywalled page or DRM-protected source. Unsupported, inaccessible or failed reads consume 0 processing units. Very large supported sources may return partial context with an explicit truncation notice.',
    'Make sure the URL points to one supported public item — not a profile, feed, search page, private item, paywall or DRM-protected source. Failed reads use 0 processing units; very large sources may return partial context.',
    'support scope copy',
)
main = replace_once(
    main,
    'Send your Link2AI account email, platform, public URL, exact error message and job ID if one is shown. Never send passwords, card numbers, private-account credentials or identity documents.',
    'Include your Link2AI account email, platform, public URL, exact error message and job ID. Never send passwords, card numbers or private-account credentials.',
    'support email copy',
)
main = replace_once(
    main,
    'Check whether Claude mentions that the source was truncated or partially processed. Large discussions, PRs, pages and PDFs can hit safe processing limits. That is different from a failed read: Link2AI returns the processed portion, marks it as partial, and charges only for what was successfully processed.',
    'If Claude says the source was truncated or partially processed, the read did not fail. Link2AI returns the processed portion, marks it partial, and charges only for what was successfully processed.',
    'support partial-read copy',
)

final_css = r'''
/* Final canvas + typography pass · 2026-09-17 */
html,body{min-height:100%;}
body{min-height:100svh;background:radial-gradient(circle at 78% -10%,rgba(106,120,255,.18),transparent 40%),radial-gradient(circle at 3% 8%,rgba(179,123,255,.11),transparent 31%),linear-gradient(180deg,#fbfaff 0%,#f8f7fc 54%,#f5f3fa 100%)!important;background-attachment:fixed!important;background-size:cover!important}
main,.section,footer{background:transparent!important}
nav{background:transparent!important;border-bottom-color:transparent!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;box-shadow:none!important;transition:background .18s ease,box-shadow .18s ease,backdrop-filter .18s ease}
nav.scrolled:not(.home-nav){background:rgba(248,247,252,.88)!important;backdrop-filter:blur(18px)!important;-webkit-backdrop-filter:blur(18px)!important;box-shadow:0 8px 28px rgba(34,28,52,.08)!important}
.sim-run:disabled{opacity:.68;cursor:wait;transform:none!important}
.sim-panel.with .sim-answer ul{display:block;margin:8px 0 0;padding-left:17px}
.sim-panel.with .sim-answer li{margin:4px 0}
@media(min-width:901px){
  .wrap{max-width:1480px;padding-left:48px;padding-right:48px}
  .home-nav{width:min(calc(100vw - 96px),1384px)}
  body[data-path]:not([data-path="/"]) .section{padding:64px 0 58px!important;border-top:0}
  body[data-path]:not([data-path="/"]) .section-head{display:grid;grid-template-columns:minmax(0,1.08fr) minmax(360px,.92fr);gap:64px;align-items:end;margin-bottom:34px}
  body[data-path]:not([data-path="/"]) .section h2{font-size:clamp(50px,4.3vw,68px);line-height:.98;max-width:880px}
  body[data-path]:not([data-path="/"]) .section .sub{font-size:18px;line-height:1.55;max-width:640px;justify-self:end}
  body[data-path]:not([data-path="/"]) .feature-grid{gap:20px}
  body[data-path]:not([data-path="/"]) .card{padding:28px 30px}
  body[data-path]:not([data-path="/"]) .source-grid,body[data-path]:not([data-path="/"]) .use-grid{gap:20px}
  body[data-path]:not([data-path="/"]) .source-card,body[data-path]:not([data-path="/"]) .use-card{padding:28px 30px}

  .home-only .experience-hero{min-height:100svh;padding:88px 0 46px;display:flex;align-items:center}
  .home-only .home-inner{width:min(100%,1460px);max-width:1460px;padding-left:48px;padding-right:48px}
  .home-only .experience-copy{max-width:1380px;margin-bottom:20px}
  .home-only .experience-hero h1{font-size:clamp(70px,5.5vw,92px);line-height:.93}
  .home-only .experience-lede{font-size:18px;max-width:900px}
  .home-only .sim-shell{max-width:1280px;margin-top:22px}
  .home-only .experience-hero-cta{margin-top:18px}

  body[data-path="/support"] #main-content{padding-bottom:24px}
  body[data-path="/support"] .connect-hero{max-width:none;margin:0;padding:64px 0 28px!important;display:grid;grid-template-columns:minmax(0,1.08fr) minmax(380px,.92fr);grid-template-rows:auto auto auto;column-gap:72px;row-gap:10px;text-align:left!important}
  body[data-path="/support"] .connect-hero .badge{grid-column:1;grid-row:1;justify-self:start}
  body[data-path="/support"] .connect-hero h1{grid-column:1;grid-row:2;font-size:clamp(58px,5vw,78px);line-height:.95;max-width:850px;margin:10px 0 8px}
  body[data-path="/support"] .connect-hero>p:not(.micro){grid-column:1;grid-row:3;font-size:18px;line-height:1.55;max-width:720px;margin:0}
  body[data-path="/support"] .connect-hero .actions{grid-column:2;grid-row:2;align-self:end;justify-self:start;margin:0;display:flex;gap:10px}
  body[data-path="/support"] .connect-hero .micro{grid-column:2;grid-row:3;align-self:start;margin:0;font-size:13px}
  body[data-path="/support"] .support-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;margin:18px 0 30px}
  body[data-path="/support"] .support-grid .card{min-height:0;padding:26px 28px}
  body[data-path="/support"] .support-grid .card .kicker{margin-bottom:12px}
  body[data-path="/support"] .support-grid .card h3{font-size:22px;line-height:1.18;margin-bottom:10px}
  body[data-path="/support"] .support-grid .card p{font-size:15px;line-height:1.55;max-width:42ch}
  body[data-path="/support"] .scope-note{margin-top:0!important;margin-bottom:46px!important;padding:16px 18px;border-radius:18px}
  body[data-path="/support"] .scope-note p{font-size:13px;line-height:1.5}
}
@media(max-width:1100px) and (min-width:651px){
  body[data-path="/support"] .connect-hero{display:block;padding-top:48px!important}
  body[data-path="/support"] .connect-hero .actions{margin-top:22px}
  body[data-path="/support"] .connect-hero .micro{margin-top:12px}
}
@media(max-width:650px){
  body{background:radial-gradient(circle at 84% -4%,rgba(106,120,255,.16),transparent 38%),radial-gradient(circle at 4% 8%,rgba(179,123,255,.10),transparent 30%),linear-gradient(180deg,#fbfaff,#f6f4fb)!important;background-attachment:scroll!important}
  nav.scrolled:not(.home-nav){background:rgba(248,247,252,.94)!important}
  body[data-path="/support"] .connect-hero{display:block;padding-top:38px!important}
  body[data-path="/support"] .support-grid{margin-bottom:24px}
}
'''
marker = '@media(prefers-reduced-motion:reduce){.reveal{opacity:1;transform:none;transition:none}.sim-line.live:after{animation:none}.sim-answer.show,.sim-tool.show,.sim-conclusion.show{animation:none}}'
if marker not in main:
    raise SystemExit('final CSS insertion marker not found')
main = main.replace(marker, final_css + '\n' + marker, 1)
main_path.write_text(main)

# Pricing is served by the billing router and has its own shell/CSS. Open it up on
# desktop rather than nesting the entire page inside one large white card.
billing_path = Path('src/billing/routes.ts')
billing = billing_path.read_text()
pricing_css = r'''
/* Open desktop pricing canvas · 2026-09-17 */
@media(min-width:761px){
  body{min-height:100svh;padding:28px 48px 52px;background:radial-gradient(circle at 78% -10%,rgba(106,120,255,.18),transparent 40%),radial-gradient(circle at 3% 8%,rgba(179,123,255,.11),transparent 31%),linear-gradient(180deg,#fbfaff 0%,#f8f7fc 54%,#f5f3fa 100%);background-attachment:fixed;background-size:cover}
  .shell:has(.plan-grid){width:min(1480px,100%)}
  .shell:has(.plan-grid) .topbar{min-height:64px;margin-bottom:22px}
  .hero:has(.plan-grid){background:transparent;border:0;border-radius:0;padding:24px 0 0;box-shadow:none;backdrop-filter:none}
  .hero:has(.plan-grid)>.eyebrow{margin-bottom:14px}
  .hero:has(.plan-grid) .pricing-intro{max-width:none;display:grid;grid-template-columns:minmax(0,1.12fr) minmax(360px,.88fr);gap:64px;align-items:end;margin-bottom:26px}
  .hero:has(.plan-grid) .pricing-intro h1{font-size:clamp(50px,4.1vw,70px);line-height:.98;letter-spacing:-.055em;max-width:900px;margin-bottom:0}
  .hero:has(.plan-grid) .pricing-intro p{font-size:18px;line-height:1.55;max-width:620px;margin:0;justify-self:end}
  .hero:has(.plan-grid) .plan-grid{gap:18px;margin:20px 0 18px}
  .hero:has(.plan-grid) .plan-card{padding:26px 28px;border-radius:24px;min-height:0;background:rgba(255,255,255,.82);box-shadow:0 10px 34px rgba(44,34,78,.04)}
  .hero:has(.plan-grid) .plan-card.featured{box-shadow:0 20px 52px rgba(111,84,232,.10)}
  .hero:has(.plan-grid) .plan-name{font-size:15px}
  .hero:has(.plan-grid) .plan-fit{font-size:12px;margin-top:8px}
  .hero:has(.plan-grid) .plan-price{font-size:44px;margin:12px 0}
  .hero:has(.plan-grid) .plan-list{font-size:14px;gap:9px;line-height:1.42}
  .hero:has(.plan-grid) .plan-card form{margin-top:18px}
  .hero:has(.plan-grid) .usage-rule{gap:14px;margin-top:18px}
  .hero:has(.plan-grid) .usage-rule div{padding:15px 17px;border-radius:16px;background:rgba(255,255,255,.62);font-size:12px;line-height:1.5}
  .hero:has(.plan-grid) .plan-note{max-width:1120px;font-size:12px;line-height:1.55;margin-top:16px}
}
'''
billing = replace_once(
    billing,
    '\n</style></head><body><main class="shell">',
    pricing_css + '\n</style></head><body><main class="shell">',
    'pricing CSS insertion',
)
billing_path.write_text(billing)

# Lock the homepage interaction fixes in regression coverage.
test_path = Path('test/runtime-smoke.mjs')
test = test_path.read_text()
needle = "  assert.ok(ids['sim-right-answer'].classList.contains('show'),'rerun after Reset must reveal the answer');\n"
insert = needle + "  assert.equal(ids['sim-run'].textContent,'Run again ↻','completed comparison should offer a rerun');\n  assert.doesNotMatch(ids['sim-tool'].innerHTML,/\\bready\\b/i,'loaded tool state should not repeat ready');\n  assert.match(ids['sim-right-answer'].innerHTML,/AI agents are becoming capable faster/,'YouTube proof should read as source-specific');\n"
test = replace_once(test, needle, insert, 'homepage proof regressions')
needle2 = "  assert.match(ids['sim-tool'].innerHTML,/Reading source/,'Reset must restore the tool card before another run');\n"
insert2 = needle2 + "  assert.equal(ids['sim-run'].textContent,'See the difference →','Reset should restore the initial comparison CTA');\n"
test = replace_once(test, needle2, insert2, 'reset CTA regression')
test_path.write_text(test)
