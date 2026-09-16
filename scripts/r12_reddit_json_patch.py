from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, got {count}")
    return text.replace(old, new, 1)

p = Path('src/content/linkText.ts')
s = p.read_text(encoding='utf-8')

s = replace_once(
    s,
    'const python=`import sys\\nfrom curl_cffi import requests\\npost_id=sys.argv[1]',
    'const python=`import json,sys\\nfrom curl_cffi import requests\\npost_id=sys.argv[1]',
    'add JSON parser to Reddit browser transport',
)

s = replace_once(
    s,
    'urls=[\\n f\\"https://www.reddit.com/comments/{post_id}.json?raw_json=1&limit={limit}&depth={depth}&sort=top\\",\\n f\\"https://old.reddit.com/comments/{post_id}.json?raw_json=1&limit={limit}&depth={depth}&sort=top\\",\\n f\\"https://api.reddit.com/comments/{post_id}?raw_json=1&limit={limit}&depth={depth}&sort=top\\"\\n]\\nheaders={\\"accept\\":\\"application/json,text/plain,*/*\\",\\"accept-language\\":\\"en-US,en;q=0.9\\",\\"cache-control\\":\\"no-cache\\"}',
    'urls=[\\n f\\"https://api.reddit.com/comments/{post_id}?raw_json=1&limit={limit}&depth={depth}&sort=top\\",\\n f\\"https://www.reddit.com/comments/{post_id}.json?raw_json=1&limit={limit}&depth={depth}&sort=top\\",\\n f\\"https://old.reddit.com/comments/{post_id}.json?raw_json=1&limit={limit}&depth={depth}&sort=top\\"\\n]\\nheaders={\\"accept\\":\\"application/json,text/plain,*/*\\",\\"accept-language\\":\\"en-US,en;q=0.9\\",\\"cache-control\\":\\"no-cache\\",\\"user-agent\\":\\"Link2AI/1.2 public-link-reader (+https://api-production-0383e.up.railway.app/support)\\"}',
    'prefer Reddit API and identify client',
)

old = '  if 200 <= status < 300:\\n   body=response.content\\n   if len(body)>3000000:\\n    last=\\"response_too_large\\"\\n    continue\\n   sys.stdout.buffer.write(body)\\n   raise SystemExit(0)\\n  last=f\\"http_{status}\\"'
new = '  if 200 <= status < 300:\\n   body=response.content\\n   if len(body)>3000000:\\n    last=\\"response_too_large\\"\\n    continue\\n   try:\\n    payload=response.json()\\n   except Exception:\\n    content_type=(response.headers.get(\\"content-type\\") or \\"unknown\\").split(\\";\\",1)[0]\\n    safe_type=\\"\\".join(ch for ch in content_type if ch.isalnum() or ch in \\"/+.-\\")[:40] or \\"unknown\\"\\n    last=f\\"non_json_{status}_{safe_type}\\"\\n    continue\\n   sys.stdout.write(json.dumps(payload,ensure_ascii=False,separators=(\\",\\",\\":\\")))\\n   raise SystemExit(0)\\n  last=f\\"http_{status}\\"'
s = replace_once(s, old, new, 'validate Reddit fallback body before success')
p.write_text(s, encoding='utf-8')

p = Path('test/reddit-egress-schema.mjs')
s = p.read_text(encoding='utf-8')
anchor = "assert.ok(source.includes('from curl_cffi import requests'));\n"
extra = "assert.ok(source.includes('import json,sys'));\nassert.ok(source.includes('payload=response.json()'));\nassert.ok(source.includes('non_json_'));\nassert.ok(source.indexOf('https://api.reddit.com/comments/{post_id}') < source.indexOf('https://www.reddit.com/comments/{post_id}'));\n"
if extra in s:
    raise SystemExit('R12 schema assertions already present')
s = replace_once(s, anchor, anchor + extra, 'add R12 regression assertions')
p.write_text(s, encoding='utf-8')
