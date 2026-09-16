from pathlib import Path
p=Path('src/api/main.ts')
s=p.read_text(encoding='utf-8')
changes=[
  ('.experience-home{margin:0 -28px;overflow:hidden}', '.experience-home{width:100vw;position:relative;left:50%;margin-left:-50vw;overflow:hidden}', 'full bleed homepage'),
  ('@media(max-width:900px){.experience-home{margin:0}.experience-home .home-inner{padding-left:22px;padding-right:22px}', '@media(max-width:900px){.experience-home .home-inner{padding-left:22px;padding-right:22px}', 'tablet full bleed'),
  ('@media(max-width:900px){.experience-home .home-inner', '@media(max-width:1080px){.navlinks{gap:14px}.navlinks .hide-sm{font-size:12px}}\n@media(max-width:900px){.experience-home .home-inner', 'nav responsive spacing'),
]
for old,new,label in changes:
    n=s.count(old)
    if n!=1:
        raise SystemExit(f'{label}: expected 1 match, got {n}')
    s=s.replace(old,new,1)
p.write_text(s,encoding='utf-8')
