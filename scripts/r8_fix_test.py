from pathlib import Path

p = Path('test/runtime-smoke.mjs')
s = p.read_text(encoding='utf-8')
old = "if(route==='/'){assert.match(body,/AI is smart\\./);assert.match(body,/Until you give it a link\\./);assert.match(body,/Try Link2AI free/);"
new = "if(route==='/'){assert.match(body,/AI is smart\\./);assert.match(body,/hero-mid\\\">Until you give it<\\/span><span class=\\\"hero-last\\\">a link\\.<\\/span>/);assert.match(body,/Try Link2AI free/);"
if s.count(old) != 1:
    raise SystemExit(f'expected 1 stale hero assertion, got {s.count(old)}')
p.write_text(s.replace(old,new,1),encoding='utf-8')
