from pathlib import Path

# Keep the homepage JS resilient now that source/use-case modules live on other routes.
p=Path('src/api/main.ts')
s=p.read_text()
s=s.replace("q('#source-open-sim').addEventListener('click'","q('#source-open-sim')?.addEventListener('click'",1)
p.write_text(s)

# Runtime smoke: homepage is now a one-screen shell, while deeper content has dedicated routes.
p=Path('test/runtime-smoke.mjs')
s=p.read_text()
s=s.replace("for(const route of ['/','/connect','/support','/privacy','/terms']){","for(const route of ['/','/examples','/use-cases','/sources','/connect','/support','/privacy','/terms']){",1)
start=s.index("    if(route==='/'){")
end=s.index("\n    if(route==='/connect'){",start)
new_home="""    if(route==='/'){
      assert.match(body,/<nav class=\"home-nav\" aria-label=\"Primary\">/);
      assert.match(body,/class=\"experience-home home-only\"/);
      assert.match(body,/Paste a link\./);
      assert.match(body,/Claude can read it\./);
      assert.match(body,/Interactive comparison · Claude-first/);
      assert.match(body,/See the difference/);
      assert.match(body,/href=\"\/examples\"/);
      assert.match(body,/href=\"\/use-cases\"/);
      assert.match(body,/href=\"\/sources\"/);
      assert.match(body,/href=\"\/pricing\"/);
      assert.match(body,/src=\"\/home\.js\?v=20260917-homeonly1\" defer/);
      assert.doesNotMatch(body,/One missing layer/i);
      assert.doesNotMatch(body,/What do you want Claude to read\?/);
      assert.doesNotMatch(body,/Try the link Claude just failed to read\./);
      assert.doesNotMatch(body,/Built by Eason Systems/);
    }
    if(route==='/examples'){assert.match(body,/YouTube \/ Shorts/);assert.match(body,/GitHub Issues \/ PRs/);assert.match(body,/Try the interactive comparison/);}
    if(route==='/use-cases'){assert.match(body,/Use the link normally/);assert.match(body,/Summaries grounded in the source/);}
    if(route==='/sources'){assert.match(body,/Supported sources/);assert.match(body,/Video & social/);assert.match(body,/Reddit/);assert.match(body,/Paused until approved Reddit OAuth Data API credentials are configured/);}"""
s=s[:start]+new_home+s[end:]
s=s.replace("/home.js?v=20260917-chat2","/home.js?v=20260917-homeonly1")
p.write_text(s)

# The hero now includes a full-viewport min-height contract.
p=Path('test/mobile-homepage-css.mjs')
s=p.read_text()
s=s.replace("assert.match(source,/\\.experience-hero\\{position:relative;margin-top:0;padding:112px 0 58px/);","assert.match(source,/\\.experience-hero\\{min-height:100svh;position:relative;margin-top:0;padding:112px 0 58px/);",1)
p.write_text(s)
