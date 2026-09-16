from pathlib import Path
import re

p = Path('src/api/main.ts')
s = p.read_text(encoding='utf-8')

def replace_once(old: str, new: str, label: str) -> None:
    global s
    n = s.count(old)
    if n != 1:
        raise SystemExit(f'{label}: expected 1 match, got {n}')
    s = s.replace(old, new, 1)

replace_once(
    '.hero h1{font-size:clamp(52px,7vw,82px);line-height:.95;letter-spacing:-.068em;margin:19px 0 24px;max-width:760px}.hero h1 em{font-style:normal;background:linear-gradient(120deg,#6f54e8 20%,#a067ef 55%,#e38d63);-webkit-background-clip:text;background-clip:text;color:transparent}',
    '.hero h1{font-size:clamp(52px,7vw,82px);line-height:.95;letter-spacing:-.068em;margin:19px 0 24px;max-width:760px}.hero h1 .hero-top,.hero h1 em,.hero h1 em span{display:block}.hero h1 .hero-mid,.hero h1 .hero-last{white-space:nowrap}.hero h1 em{font-style:normal;background:linear-gradient(120deg,#6f54e8 20%,#a067ef 55%,#e38d63);-webkit-background-clip:text;background-clip:text;color:transparent}',
    'hero css',
)
replace_once(
    '<h1>AI is smart.<br><em>Until you give it a link.</em></h1>',
    '<h1><span class="hero-top">AI is smart.</span><em><span class="hero-mid">Until you give it</span><span class="hero-last">a link.</span></em></h1>',
    'hero markup',
)

replace_once(
    'visitors_total:string;visitors_24h:string;visitors_7d:string;pageviews_total:string;pageviews_24h:string;pageviews_7d:string;\n      connect_visitors_total:string;signed_up_total:string;activated_visitors_total:string;non_founder_7d:string;',
    'visitors_total:string;visitors_24h:string;visitors_7d:string;pageviews_total:string;pageviews_24h:string;pageviews_7d:string;\n      external_pageviews_total:string;external_pageviews_24h:string;external_pageviews_7d:string;\n      connect_visitors_total:string;signed_up_total:string;activated_visitors_total:string;non_founder_7d:string;',
    'analytics type',
)
replace_once(
    "      (SELECT COUNT(*) FROM website_pageviews WHERE created_at>now()-interval '7 days')::text AS pageviews_7d,\n      (SELECT COUNT(DISTINCT visitor_id) FROM website_pageviews WHERE path='/connect')::text AS connect_visitors_total,",
    "      (SELECT COUNT(*) FROM website_pageviews WHERE created_at>now()-interval '7 days')::text AS pageviews_7d,\n      (SELECT COUNT(*) FROM website_pageviews p JOIN website_visitors v ON v.visitor_id=p.visitor_id LEFT JOIN users u ON u.id=v.user_id WHERE COALESCE(lower(u.email),'')<>$1 AND COALESCE(u.analytics_excluded,false)=false)::text AS external_pageviews_total,\n      (SELECT COUNT(*) FROM website_pageviews p JOIN website_visitors v ON v.visitor_id=p.visitor_id LEFT JOIN users u ON u.id=v.user_id WHERE p.created_at>now()-interval '24 hours' AND COALESCE(lower(u.email),'')<>$1 AND COALESCE(u.analytics_excluded,false)=false)::text AS external_pageviews_24h,\n      (SELECT COUNT(*) FROM website_pageviews p JOIN website_visitors v ON v.visitor_id=p.visitor_id LEFT JOIN users u ON u.id=v.user_id WHERE p.created_at>now()-interval '7 days' AND COALESCE(lower(u.email),'')<>$1 AND COALESCE(u.analytics_excluded,false)=false)::text AS external_pageviews_7d,\n      (SELECT COUNT(DISTINCT visitor_id) FROM website_pageviews WHERE path='/connect')::text AS connect_visitors_total,",
    'external pageview sql',
)
replace_once(
    '  const visitors=founderNum(a?.visitors_total),visitorSignups=founderNum(a?.signed_up_total),visitorActivated=founderNum(a?.activated_visitors_total),connectVisitors=founderNum(a?.connect_visitors_total);',
    '  const visitors=founderNum(a?.visitors_total),visitorSignups=founderNum(a?.signed_up_total),visitorActivated=founderNum(a?.activated_visitors_total),connectVisitors=founderNum(a?.connect_visitors_total);\n  const externalPageviews=founderNum(a?.external_pageviews_total),externalPageviews24h=founderNum(a?.external_pageviews_24h),externalPageviews7d=founderNum(a?.external_pageviews_7d);',
    'pageview variables',
)

pattern = re.compile(r'''    <section class="fd-grid">\n.*?    </section>\n    <section><div class="fd-label" style="margin-bottom:8px">外部啟用漏斗''', re.S)
replacement = '''    <section class="fd-grid">
      <div class="fd-card"><div class="fd-label">瀏覽次數</div><div class="fd-value">${externalPageviews}</div><div class="fd-note">今天 ${externalPageviews24h} · 近 7 天 ${externalPageviews7d} · 排除 Founder / 內部測試</div></div>
      <div class="fd-card"><div class="fd-label">外部訪客</div><div class="fd-value">${externalVisitorsAll}</div><div class="fd-note">近 7 天 ${founderNum(a?.non_founder_7d)} · 不重複訪客</div></div>
      <div class="fd-card"><div class="fd-label">外部註冊</div><div class="fd-value">${externalSignups}</div><div class="fd-note">註冊率 ${founderPct(externalSignups,Math.max(activationVisitors,1))} · 送出 ${signupSubmits} · 失敗 ${signupFailures}</div></div>
      <div class="fd-card"><div class="fd-label">首次成功使用</div><div class="fd-value">${externalActivated}</div><div class="fd-note">外部已連接 Claude ${externalConnected} · 註冊→首次成功 ${founderPct(externalActivated,Math.max(externalSignups,1))}</div></div>
      <div class="fd-card"><div class="fd-label">成功讀取</div><div class="fd-value">${links}</div><div class="fd-note">今天 +${founderNum(m?.links_24h)} · 近 7 天 +${founderNum(m?.links_7d)}</div></div>
      <div class="fd-card"><div class="fd-label">失敗工作</div><div class="fd-value">${founderNum(m?.failed_24h)}</div><div class="fd-note">今天 · 近 7 天 ${founderNum(m?.failed_7d)}</div></div>
      <div class="fd-card"><div class="fd-label">付費使用者</div><div class="fd-value">${paid}</div><div class="fd-note">Basic ${founderNum(m?.basic_total)} · Pro ${founderNum(m?.pro_total)}</div></div>
      <div class="fd-card"><div class="fd-label">已處理內容</div><div class="fd-measure"><div class="fd-value">${founderUnits(seconds)}</div><div class="fd-unitline">processing units</div></div><div class="fd-note">近 7 天 ${founderUnits(m?.seconds_7d)} units</div></div>
    </section>
    <section><div class="fd-label" style="margin-bottom:8px">外部啟用漏斗'''
s2, n = pattern.subn(replacement, s, count=1)
if n != 1:
    raise SystemExit(f'Founder top metrics replacement: expected 1 match, got {n}')
s = s2

# Remove obsolete Founder styles that lived in the global marketing stylesheet before founderCss became dedicated.
s = s.replace('.fd-funnel.activation{display:flex;overflow-x:auto;gap:8px;padding-bottom:4px}.fd-funnel.activation .fd-step{min-width:142px;flex:1}', '')

p.write_text(s, encoding='utf-8')

# Update the runtime smoke assertion to validate the intentional visual line split.
tp = Path('test/runtime-smoke.mjs')
t = tp.read_text(encoding='utf-8')
old = "if(route==='/'){assert.match(body,/AI is smart\\./);assert.match(body,/Until you give it a link\\./);assert.match(body,/Try Link2AI free/);"
new = "if(route==='/'){assert.match(body,/AI is smart\\./);assert.match(body,/hero-mid\\\">Until you give it<\\/span><span class=\\\"hero-last\\\">a link\\.<\\/span>/);assert.match(body,/Try Link2AI free/);"
if t.count(old) != 1:
    raise SystemExit(f'runtime hero assertion: expected 1 match, got {t.count(old)}')
t = t.replace(old, new, 1)
tp.write_text(t, encoding='utf-8')
