function esc(value:string){return value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));}
function code(value:string){return `<pre class="api-code"><code>${esc(value)}</code></pre>`;}

export function developerDocs(baseUrl:string):string{
  const base=baseUrl.replace(/\/$/,'');
  const curl=`curl ${base}/v1/read \\
  -H "Authorization: Bearer $LINK2AI_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"url":"https://news.ycombinator.com/item?id=8863"}'`;
  const js=`const base = ${JSON.stringify(base)};
const headers = {
  Authorization: \`Bearer \${process.env.LINK2AI_API_KEY}\`,
  "Content-Type": "application/json"
};

let response = await fetch(\`\${base}/v1/read\`, {
  method: "POST", headers,
  body: JSON.stringify({ url: "https://news.ycombinator.com/item?id=8863" })
});
let result = await response.json();
while (response.status === 202) {
  await new Promise(resolve => setTimeout(resolve, 2000));
  response = await fetch(\`\${base}/v1/jobs/\${result.id}\`, { headers });
  result = await response.json();
}
if (!response.ok) throw new Error(\`\${result.error_code}: \${result.message}\`);
console.log(result.content);`;
  const python=`import os, time, requests

base = ${JSON.stringify(base)}
headers = {"Authorization": f"Bearer {os.environ['LINK2AI_API_KEY']}"}
response = requests.post(f"{base}/v1/read", headers=headers,
    json={"url": "https://news.ycombinator.com/item?id=8863"})
result = response.json()
while response.status_code == 202:
    time.sleep(2)
    response = requests.get(f"{base}/v1/jobs/{result['id']}", headers=headers)
    result = response.json()
response.raise_for_status()
print(result["content"])`;

  return `<main id="main-content" class="api-docs">
  <section class="connect-hero api-hero"><span class="badge"><span class="badge-dot"></span>Public REST API</span><h1>One source engine. Any client.</h1><p>Use the same Link2AI jobs, cache, quota, provenance, and source extraction engine used by Claude, Grok, and compatible MCP clients.</p><div class="actions"><a class="btn purple" href="/account">Create an API key →</a><a class="btn alt" href="#quickstart">Open quickstart</a><a class="btn alt" href="/sources">Supported sources</a></div></section>
  <section class="section api-layout" style="padding-top:18px">
    <nav class="card api-toc" aria-label="API documentation"><strong>On this page</strong><a href="#key">API key</a><a href="#quickstart">Quickstart</a><a href="#lifecycle">Read lifecycle</a><a href="#response">Response fields</a><a href="#errors">Errors</a><a href="#usage">Usage & refresh</a><a href="#endpoints">Usage & sources</a><a href="#examples">JavaScript & Python</a></nav>
    <div class="api-content">
      <section class="card" id="key"><div class="kicker">1 · Authenticate</div><h2>Create and protect an API key</h2><ol><li>Sign in to <a href="/account"><strong>Account</strong></a>.</li><li>Under Developer API, name and create a key.</li><li>Copy it immediately; the full secret is shown once and only its hash is stored.</li></ol><p>Send it on every API request as <code>Authorization: Bearer l2ai_live_…</code>. Keep it in a secret manager or environment variable—never source control, browser code, logs, or a URL. Revoke keys from Account when no longer needed.</p></section>
      <section class="card" id="quickstart"><div class="kicker">2 · First request</div><h2>POST /v1/read</h2>${code(curl)}<p>A fast read returns <strong>200 completed</strong>. Work that continues asynchronously returns <strong>202 processing</strong>. Both responses identify the job using <code>id</code>; <code>job_id</code> is the equivalent compatibility alias.</p></section>
      <section class="card" id="lifecycle"><div class="kicker">3 · Lifecycle</div><h2>Poll until terminal</h2><div class="api-flow"><span>POST /v1/read</span><b>→</b><span>200 completed</span><em>or</em><span>202 processing + id</span><b>→</b><span>GET /v1/jobs/{id}</span></div><p>For a 202, wait briefly and poll with the same bearer header. Stop when <code>status</code> is <code>completed</code>, <code>payment_required</code>, or <code>failed</code>. Respect <code>retry_after_seconds</code> when present and only automate retries when <code>retryable</code> is true.</p>${code(`GET ${base}/v1/jobs/{id}\nAuthorization: Bearer $LINK2AI_API_KEY`)}</section>
      <section class="card" id="response"><div class="kicker">Contract</div><h2>Completed response</h2>${code(`{
  "id": "7f…", "job_id": "7f…", "status": "completed",
  "source_type": "hackernews", "source_url": "https://…",
  "canonical_url": "https://news.ycombinator.com/item?id=8863",
  "source_key": "hackernews:8863", "title": "…", "creator": "…",
  "content": "AI-ready source text…", "transcript": "AI-ready source text…",
  "metadata": {
    "duration_seconds": null, "language": null, "transcript_source": null,
    "source_fetched_at": "…", "cache_expires_at": "…",
    "items_available": 42, "items_extracted": 42,
    "pages_available": null, "pages_extracted": null
  },
  "evidence": [], "source_completeness": "complete",
  "units_used": 1, "remaining_usage_units": 9
}`)}<p><code>canonical_url</code> is Link2AI's normalized source URL and <code>source_key</code> is its stable source identity. <code>metadata</code> carries source-specific counts and provenance; <code>evidence</code> carries timestamped or located excerpts when available.</p><p><code>source_completeness</code> is <code>complete</code> or <code>partial</code>. For partial results inspect <code>truncation_reason</code> and <code>content_sections_truncated</code>; never silently treat partial content as the whole source.</p></section>
      <section class="card" id="errors"><div class="kicker">Failures</div><h2>Handle status, code, and retryability together</h2><div class="api-table"><div><strong>401</strong><span>Missing, invalid, or revoked bearer key. Create or replace the key; do not retry unchanged credentials.</span></div><div><strong>402</strong><span><code>payment_required</code>. <code>required_usage_units</code> states the need; add units before retrying.</span></div><div><strong>422</strong><span>Supported request could not be extracted. Inspect <code>error_code</code>, <code>message</code>, and <code>retryable</code>.</span></div></div><p>Error bodies expose both <code>error_code</code> and the backward-compatible <code>error</code> alias with the same value. Request validation may also return 400. Failed, unsupported, private, login-required, empty, or inaccessible reads consume <strong>0 units</strong>.</p>${code(`{
  "error": "SOURCE_UNAVAILABLE",
  "error_code": "SOURCE_UNAVAILABLE",
  "message": "The public source could not be read.",
  "retryable": true
}`)}</section>
      <section class="card" id="usage"><div class="kicker">Cost & cache</div><h2>Usage, retries, cache, and refresh</h2><p>Successful video reads use one unit per started processed minute. Successful text reads use roughly one unit per 2,500 estimated source tokens, with a one-unit minimum. <code>units_used</code> reports the charge for that result; <code>remaining_usage_units</code> reports the balance.</p><p>Ordinary retries and cache hits reuse the shared job/cache accounting and must not double-charge. Send <code>{"url":"…","refresh":true}</code> only when you intentionally need a fresh upstream fetch. Refresh can create new billable processing when successful, so do not use it as a polling or retry mechanism.</p></section>
      <section class="card" id="endpoints"><div class="kicker">Discover</div><h2>GET /v1/usage and GET /v1/sources</h2><p><code>GET /v1/usage</code> returns the authoritative shared balance used by REST and connected AI clients. <code>GET /v1/sources</code> returns the current supported-source policy; use it instead of hard-coding a separate client allowlist.</p>${code(`curl ${base}/v1/usage -H "Authorization: Bearer $LINK2AI_API_KEY"\ncurl ${base}/v1/sources -H "Authorization: Bearer $LINK2AI_API_KEY"`)}</section>
      <section class="card" id="examples"><div class="kicker">Complete examples</div><h2>JavaScript</h2>${code(js)}<h2 style="margin-top:24px">Python</h2>${code(python)}<div class="actions"><a class="btn purple" href="/account">Create API key →</a><a class="btn alt" href="/account">View recent jobs & usage</a></div></section>
    </div>
  </section>
  <style>.api-docs{scroll-behavior:smooth}.api-hero{text-align:left;margin-left:0;max-width:900px}.api-layout{display:grid;grid-template-columns:210px minmax(0,1fr);gap:18px;align-items:start}.api-toc{position:sticky;top:22px;display:grid;gap:9px;font-size:12px}.api-toc a{text-decoration:none;color:#6f6877}.api-content{display:grid;gap:16px;min-width:0}.api-content .card{margin:0}.api-content h2{font-size:26px;letter-spacing:-.035em}.api-content li,.api-content p{line-height:1.65}.api-code{overflow:auto;padding:18px;border-radius:16px;background:#17151f;color:#f8f6ff;line-height:1.55;font-size:12px;white-space:pre}.api-flow{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:15px 0}.api-flow span{padding:8px 10px;border-radius:10px;background:#f2effc;font:700 11px ui-monospace,monospace}.api-flow em{color:#8b8492;font-size:11px}.api-table{display:grid;gap:8px;margin:14px 0}.api-table>div{display:grid;grid-template-columns:52px 1fr;gap:10px;padding:12px;border:1px solid rgba(52,45,66,.1);border-radius:12px}.api-table span{font-size:12px;line-height:1.5;color:#6f6877}@media(max-width:800px){.api-layout{grid-template-columns:1fr}.api-toc{position:static;grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:520px){.api-toc{grid-template-columns:1fr}.api-code{font-size:10px;padding:14px}.api-content h2{font-size:23px}}</style>
  </main>`;
}
