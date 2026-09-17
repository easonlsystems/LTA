from pathlib import Path

p=Path('src/api/main.ts')
s=p.read_text()
marker='@media(prefers-reduced-motion:reduce){'
if marker not in s:
    raise SystemExit('CSS marker not found')
css=r'''
/* Unified full-canvas layout · 2026-09-17 */
html,body{min-height:100%;}
body{min-height:100svh;background:radial-gradient(circle at 76% -8%,rgba(108,118,255,.17),transparent 39%),radial-gradient(circle at 5% 7%,rgba(156,118,255,.10),transparent 30%),linear-gradient(180deg,#fbfaff 0%,#f8f7fc 52%,#f6f4fb 100%);background-attachment:fixed}
nav{background:transparent!important;border-bottom-color:transparent!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;box-shadow:none!important}
.home-nav{background:transparent!important}
.experience-home,.experience-hero{background:transparent!important}
.home-only{min-height:100svh}
.home-only .experience-hero{min-height:100svh;display:flex;align-items:center}
@media(min-width:901px){
  .home-only .experience-hero{padding:88px 0 42px}
  .home-only .home-inner{width:min(100%,1360px);max-width:1360px;margin:0 auto;padding-left:34px;padding-right:34px}
  .home-only .experience-copy{margin-bottom:24px}
  .home-only .experience-hero h1{font-size:clamp(64px,5vw,84px);line-height:.94;max-width:none}
  .home-only .experience-lede{font-size:18px;max-width:880px}
  .home-only .sim-shell{max-width:1180px;margin-top:26px}
  .home-only .experience-hero-cta{margin-top:20px}
}
@media(min-width:651px) and (max-width:900px){
  .home-only .experience-hero{padding-top:92px;padding-bottom:40px}
  .home-only .sim-shell{max-width:none}
}
@media(max-width:650px){
  body{background-attachment:scroll}
  .home-only .experience-hero{min-height:100svh;align-items:flex-start}
}

'''
if 'Unified full-canvas layout · 2026-09-17' not in s:
    s=s.replace(marker,css+marker,1)
p.write_text(s)
