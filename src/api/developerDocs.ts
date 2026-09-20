function esc(value:string){return value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));}
function code(value:string){return `<pre class="api-code"><code>${esc(value)}</code></pre>`;}

export function developerDocs(baseUrl:string):string{
  const base=baseUrl.replace(/\/$/,'');
  const curl=`curl ${base}/v1/read \\\
  -H "Authorization: Bearer $LINK2AI_API_KEY" \\\
  -H "Content-Type: application/json" \\\
  -d '{"url":"https://news.ycombinator.com/item?id=8863"}'`;
  const curlUsage=`curl ${base}/v1/usage \\\
  -H "Authorization: Bearer $LINK2AI_API_KEY"`;
  const powershell=`$env:LINK2AI_API_KEY = "PASTE_YOUR_KEY_HERE"
$headers = @{ Authorization = "Bearer $env:LINK2AI_API_KEY" }
$body = @{ url = "https://news.ycombinator.com/item?id=8863" } | ConvertTo-Json

Invoke-RestMethod \`
  -Method Post \`
  -Uri "${base}/v1/read" \`
  -Headers $headers \`
  -ContentType "application/json" \`
  -Body $body`;
  const js=`const base = ${JSON.stringify(base)};
const headers = {
  Authorization: \`Bearer \${process.env.LINK2AI_API_KEY}\`,
  "Content-Type": "application/json"
};

let response = await fetch(\`\${base}/v1/read\`, {
  method: "POST",
  headers,
  body: JSON.stringify({ url: "https://news.ycombinator.com/item?id=8863" })
});
let result = await response.json();

while (response.status === 202) {
  await new Promise(resolve => setTimeout(resolve, result.retry_after_seconds ? result.retry_after_seconds * 1000 : 2000));
  response = await fetch(\`\${base}/v1/jobs/\${result.id}\`, { headers });
  result = await response.json();
}

if (!response.ok) throw new Error(\`\${result.error_code}: \${result.message}\`);
console.log(result.content);`;

  const python=`import os, time, requests

base = ${JSON.stringify(base)}
headers = {"Authorization": f"Bearer {os.environ['LINK2AI_API_KEY']}"}

response = requests.post(
    f"{base}/v1/read",
    headers=headers,
    json={"url": "https://news.ycombinator.com/item?id=8863"}
)
result = response.json()

while response.status_code == 202:
    time.sleep(result.get("retry_after_seconds", 2))
    response = requests.get(f"{base}/v1/jobs/{result['id']}", headers=headers)
    result = response.json()

response.raise_for_status()
print(result["content"])`;

  return `<main id="main-content" class="api-docs">
  <section class="api-hero">
    <div class="api-hero-copy">
      <span class="badge"><span class="badge-dot"></span>Public REST API</span>
      <h1>Give your app the source.</h1>
      <p>Send a supported public URL. Link2AI returns AI-ready source context with provenance, completeness, and usage in one shared source engine.</p>
      <div class="api-paths">
        <a class="api-path" href="/connect"><span>I just want Link2AI inside an AI</span><strong>Connect an AI →</strong><small>No API key needed.</small></a>
        <a class="api-path active" href="#quickstart"><span>I'm building an app or automation</span><strong>Use the Developer API →</strong><small>Generate a key, then call Link2AI from your code.</small></a>
      </div>
      <div class="actions"><a class="btn purple" href="/account">Generate API key →</a><a class="btn alt" href="#quickstart">Make your first request</a><a class="btn alt" href="/sources">Supported sources</a></div>
      <div class="api-hero-meta"><span>Base URL <code>${esc(base)}</code></span><span>Bearer auth</span><span>Failed reads cost 0 units</span></div>
    </div>
    <div class="api-hero-demo" aria-label="API example">
      <div class="api-demo-top"><span></span><span></span><span></span><strong>POST /v1/read</strong></div>
      ${code(`{
  "url": "https://news.ycombinator.com/item?id=8863"
}`)}
      <div class="api-demo-result"><b>200</b><span>completed</span><code>result.content → AI-ready source text</code></div>
    </div>
  </section>

  <section class="api-start" id="quickstart">
    <div class="api-section-head"><div><span class="api-step">Quickstart</span><h2>From zero to source text in three steps.</h2></div><p>You do not need to learn the whole contract before making your first request.</p></div>
    <div class="api-start-grid">
      <article class="api-start-card">
        <span class="api-number">1</span>
        <h3>Generate a key</h3>
        <p>Go to <a href="/account"><strong>Account → Developer API</strong></a>. Choose a label such as <code>Production</code> or <code>n8n</code>. Link2AI generates the secret for you and shows it once.</p>
        <a class="api-inline-link" href="/account">Open Account →</a>
      </article>
      <article class="api-start-card">
        <span class="api-number">2</span>
        <h3>Send one URL</h3>
        <p>For a quick local test, paste your key into this PowerShell example and run it. For production, move the key into a secret manager or environment variable.</p>
        <div class="api-code-label">Windows PowerShell</div>
        ${code(powershell)}
        <details class="api-alt-example"><summary>Prefer curl?</summary>${code(curl)}</details>
      </article>
      <article class="api-start-card">
        <span class="api-number">3</span>
        <h3>Take the source text</h3>
        <p>If the response is already <code>completed</code>, your app can use <code>content</code> immediately. If it says <code>processing</code>, poll the returned job id until it finishes.</p>
        ${code(`{
  "status": "completed",
  "content": "AI-ready source text…",
  "source_completeness": "complete",
  "units_used": 1,
  "remaining_usage_units": 9
}`)}
      </article>
    </div>
  </section>

  <section class="api-product-grid">
    <article class="api-product-card"><span>01</span><h3>One endpoint to start</h3><p>Use <code>POST /v1/read</code> for supported public links. Link2AI handles platform-specific extraction behind the same API.</p></article>
    <article class="api-product-card"><span>02</span><h3>Shared account & usage</h3><p>REST and connected AI clients use the same account balance, jobs, cache, and billing rules.</p></article>
    <article class="api-product-card"><span>03</span><h3>Know when context is partial</h3><p><code>source_completeness</code> tells you whether the returned source is complete or partial instead of silently pretending truncated content is the whole source.</p></article>
  </section>

  <section class="api-reference-shell">
    <nav class="api-toc" aria-label="API documentation">
      <strong>Reference</strong>
      <a href="#auth">Authentication</a>
      <a href="#lifecycle">Read lifecycle</a>
      <a href="#response">Response contract</a>
      <a href="#errors">Errors</a>
      <a href="#usage">Usage & cache</a>
      <a href="#endpoints">Other endpoints</a>
      <a href="#examples">Examples</a>
    </nav>

    <div class="api-reference">
      <details class="api-detail" id="auth">
        <summary><div><span>Authentication</span><strong>Create and protect an API key</strong></div><b>+</b></summary>
        <div class="api-detail-body">
          <p>Link2AI generates the secret. In <a href="/account"><strong>Account</strong></a>, enter only a key name, then copy the generated key immediately. The full secret is shown once and only its hash is stored.</p>
          <p>Send it on every request as <code>Authorization: Bearer l2ai_live_…</code>. Keep it in a secret manager or environment variable—never source control, browser code, logs, or a URL. Revoke keys from Account when no longer needed.</p>
        </div>
      </details>

      <details class="api-detail" id="lifecycle">
        <summary><div><span>Lifecycle</span><strong>200 completed or 202 processing</strong></div><b>+</b></summary>
        <div class="api-detail-body">
          <div class="api-flow"><span>POST /v1/read</span><b>→</b><span>200 completed</span><em>or</em><span>202 processing + id</span><b>→</b><span>GET /v1/jobs/{id}</span></div>
          <p>A fast read returns <strong>200 completed</strong>. Work that continues asynchronously returns <strong>202 processing</strong>. Both responses identify the job using <code>id</code>; <code>job_id</code> is the equivalent compatibility alias.</p>
          <p>For a 202, wait briefly and poll <code>GET /v1/jobs/{id}</code> with the same bearer header. Stop when <code>status</code> is <code>completed</code>, <code>payment_required</code>, or <code>failed</code>. Respect <code>retry_after_seconds</code> when present and only automate retries when <code>retryable</code> is true.</p>
          ${code(`GET ${base}/v1/jobs/{id}
Authorization: Bearer $LINK2AI_API_KEY`)}
        </div>
      </details>

      <details class="api-detail" id="response">
        <summary><div><span>Contract</span><strong>Completed response fields</strong></div><b>+</b></summary>
        <div class="api-detail-body">
          ${code(`{
  "id": "7f…",
  "job_id": "7f…",
  "status": "completed",
  "source_type": "hackernews",
  "source_url": "https://…",
  "canonical_url": "https://news.ycombinator.com/item?id=8863",
  "source_key": "hackernews:8863",
  "title": "…",
  "creator": "…",
  "content": "AI-ready source text…",
  "transcript": "AI-ready source text…",
  "metadata": {
    "source_fetched_at": "…",
    "cache_expires_at": "…",
    "items_available": 42,
    "items_extracted": 42
  },
  "evidence": [],
  "source_completeness": "complete",
  "units_used": 1,
  "remaining_usage_units": 9
}`)}
          <p><code>canonical_url</code> is Link2AI's normalized source URL and <code>source_key</code> is its stable source identity. <code>metadata</code> carries source-specific counts and provenance; <code>evidence</code> carries timestamped or located excerpts when available.</p>
          <p><code>source_completeness</code> is <code>complete</code> or <code>partial</code>. For partial results inspect <code>truncation_reason</code> and <code>content_sections_truncated</code>; never silently treat partial content as the whole source.</p>
        </div>
      </details>

      <details class="api-detail" id="errors">
        <summary><div><span>Failures</span><strong>Handle status, code, and retryability together</strong></div><b>+</b></summary>
        <div class="api-detail-body">
          <div class="api-table"><div><strong>401</strong><span>Missing, invalid, or revoked bearer key. Create or replace the key; do not retry unchanged credentials.</span></div><div><strong>402</strong><span><code>payment_required</code>. <code>required_usage_units</code> states the need; add units before retrying.</span></div><div><strong>422</strong><span>Supported request could not be extracted. Inspect <code>error_code</code>, <code>message</code>, and <code>retryable</code>.</span></div></div>
          <p>Error bodies expose both <code>error_code</code> and the backward-compatible <code>error</code> alias with the same value. Request validation may also return 400. Failed, unsupported, private, login-required, empty, or inaccessible reads consume <strong>0 units</strong>.</p>
          ${code(`{
  "error": "SOURCE_UNAVAILABLE",
  "error_code": "SOURCE_UNAVAILABLE",
  "message": "The public source could not be read.",
  "retryable": true
}`)}
        </div>
      </details>

      <details class="api-detail" id="usage">
        <summary><div><span>Usage & cache</span><strong>Billing, retries, cache hits, and refresh</strong></div><b>+</b></summary>
        <div class="api-detail-body">
          <p>Successful video reads use one unit per started processed minute. Successful text reads use roughly one unit per 2,500 estimated source tokens, with a one-unit minimum. <code>units_used</code> reports the charge for that result; <code>remaining_usage_units</code> reports the balance.</p>
          <p>Ordinary retries and cache hits reuse the shared job/cache accounting and must not double-charge. Send <code>{"url":"…","refresh":true}</code> only when you intentionally need a fresh upstream fetch. Refresh can create new billable processing when successful, so do not use it as a polling or retry mechanism.</p>
        </div>
      </details>

      <details class="api-detail" id="endpoints">
        <summary><div><span>Discover</span><strong>GET /v1/usage and GET /v1/sources</strong></div><b>+</b></summary>
        <div class="api-detail-body">
          <p><code>GET /v1/usage</code> returns the authoritative shared balance used by REST and connected AI clients. <code>GET /v1/sources</code> returns the current supported-source policy; use it instead of hard-coding a separate client allowlist.</p>
          ${code(`${curlUsage}
curl ${base}/v1/sources \\\
  -H "Authorization: Bearer $LINK2AI_API_KEY"`)}
        </div>
      </details>

      <details class="api-detail" id="examples">
        <summary><div><span>Complete examples</span><strong>JavaScript and Python</strong></div><b>+</b></summary>
        <div class="api-detail-body">
          <div class="api-language-head"><h3>JavaScript</h3><span>Node.js 18+</span></div>${code(js)}
          <div class="api-language-head"><h3>Python</h3><span>requests</span></div>${code(python)}
        </div>
      </details>
    </div>
  </section>

  <section class="api-bottom-cta">
    <div><span class="api-step">Ready to build?</span><h2>Generate a key and make one request.</h2><p>Your API usage and connected AI usage stay on the same Link2AI account.</p></div>
    <div class="actions"><a class="btn purple" href="/account">Generate API key →</a><a class="btn alt" href="/account">View usage & jobs</a></div>
  </section>

  <style>
  .api-docs{max-width:1180px;margin:0 auto;padding:0 28px 80px}.api-hero{padding:72px 0 52px;display:grid;grid-template-columns:minmax(0,1.05fr) minmax(360px,.95fr);gap:54px;align-items:center}.api-hero-copy h1{font-size:clamp(48px,6vw,72px);line-height:.96;letter-spacing:-.06em;margin:18px 0 18px}.api-hero-copy>p{font-size:19px;line-height:1.6;color:#6f6a78;max-width:690px}.api-paths{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:22px 0 4px}.api-path{display:grid;gap:4px;padding:15px 16px;border:1px solid rgba(44,39,55,.11);border-radius:16px;background:rgba(255,255,255,.72);text-decoration:none}.api-path.active{border-color:rgba(111,84,232,.25);background:linear-gradient(180deg,#fff,#faf8ff)}.api-path span{font-size:11px;color:#817a89}.api-path strong{font-size:14px}.api-path small{font-size:11px;line-height:1.4;color:#6f6a78}.api-code-label{font-size:10px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;color:#756d7d;margin-top:12px}.api-alt-example{margin-top:10px}.api-alt-example summary{font-size:11px;font-weight:850;color:#5f48c9;cursor:pointer}.api-hero-meta{display:flex;gap:8px;flex-wrap:wrap;margin-top:18px}.api-hero-meta span{font-size:11px;font-weight:750;color:#6c6573;border:1px solid rgba(44,39,55,.10);background:rgba(255,255,255,.70);padding:7px 9px;border-radius:999px}.api-hero-demo{border:1px solid rgba(111,84,232,.18);border-radius:24px;background:linear-gradient(180deg,#1d1a24,#15131b);padding:16px;box-shadow:0 24px 60px rgba(42,31,78,.16)}.api-hero-demo .api-code{margin:0;border-radius:14px;background:#211e29}.api-demo-top{display:flex;align-items:center;gap:6px;color:#d3cdea;font-size:11px;margin:0 2px 12px}.api-demo-top span{width:8px;height:8px;border-radius:50%;background:#5a5465}.api-demo-top strong{margin-left:auto;font:750 10px ui-monospace,monospace;color:#bdb3e8}.api-demo-result{margin-top:10px;display:grid;grid-template-columns:auto auto 1fr;gap:8px;align-items:center;padding:10px 12px;border:1px solid rgba(255,255,255,.08);border-radius:12px;color:#d8d2e3;font-size:11px}.api-demo-result b{color:#72d7b0}.api-demo-result code{justify-self:end;color:#a99be8}.api-start{padding:34px 0 58px;border-top:1px solid rgba(44,39,55,.10)}.api-section-head{display:flex;justify-content:space-between;align-items:end;gap:30px;margin-bottom:24px}.api-section-head h2{font-size:40px;letter-spacing:-.05em;margin:6px 0 0}.api-section-head p{max-width:450px;color:#6f6a78;line-height:1.55;margin:0}.api-step{font-size:10px;font-weight:900;letter-spacing:.12em;text-transform:uppercase;color:#6f54e8}.api-start-grid{display:grid;grid-template-columns:.85fr 1.15fr 1fr;gap:14px}.api-start-card{position:relative;border:1px solid rgba(44,39,55,.11);border-radius:22px;background:rgba(255,255,255,.84);padding:22px;min-width:0}.api-number{display:grid;place-items:center;width:30px;height:30px;border-radius:10px;background:#1c1922;color:#fff;font-size:11px;font-weight:900;margin-bottom:18px}.api-start-card h3{font-size:21px;margin:0 0 9px;letter-spacing:-.035em}.api-start-card p{color:#6f6a78;line-height:1.6;font-size:14px}.api-inline-link{font-size:12px;font-weight:850;color:#5e48c8;text-decoration:none}.api-product-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;padding:0 0 58px}.api-product-card{border:1px solid rgba(44,39,55,.10);border-radius:20px;padding:21px;background:linear-gradient(180deg,#fff,#faf9fc)}.api-product-card>span{font-size:10px;font-weight:900;color:#806bea}.api-product-card h3{font-size:18px;margin:10px 0 7px}.api-product-card p{font-size:13px;line-height:1.55;color:#6f6a78;margin:0}.api-reference-shell{display:grid;grid-template-columns:190px minmax(0,1fr);gap:20px;align-items:start;padding-top:28px;border-top:1px solid rgba(44,39,55,.10)}.api-toc{position:sticky;top:94px;display:grid;gap:8px;padding:4px 0}.api-toc strong{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#89818e;margin-bottom:5px}.api-toc a{text-decoration:none;color:#655e6b;font-size:12px;padding:5px 0}.api-reference{display:grid;gap:10px}.api-detail{border:1px solid rgba(44,39,55,.11);border-radius:18px;background:rgba(255,255,255,.82);overflow:hidden}.api-detail summary{list-style:none;display:flex;align-items:center;justify-content:space-between;gap:18px;padding:18px 20px;cursor:pointer}.api-detail summary::-webkit-details-marker{display:none}.api-detail summary div{display:grid;gap:4px}.api-detail summary span{font-size:10px;text-transform:uppercase;letter-spacing:.1em;font-weight:900;color:#837b89}.api-detail summary strong{font-size:16px}.api-detail summary>b{font-size:20px;color:#6f54e8}.api-detail[open] summary>b{transform:rotate(45deg)}.api-detail-body{padding:0 20px 20px;border-top:1px solid rgba(44,39,55,.08)}.api-detail-body p,.api-detail-body li{font-size:14px;line-height:1.65;color:#68616f}.api-code{overflow:auto;padding:16px;border-radius:14px;background:#17151f;color:#f8f6ff;line-height:1.55;font-size:11px;white-space:pre;margin:14px 0}.api-flow{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:18px 0}.api-flow span{padding:8px 10px;border-radius:10px;background:#f2effc;font:700 11px ui-monospace,monospace}.api-flow em{color:#8b8492;font-size:11px}.api-table{display:grid;gap:8px;margin:16px 0}.api-table>div{display:grid;grid-template-columns:52px 1fr;gap:10px;padding:12px;border:1px solid rgba(52,45,66,.1);border-radius:12px}.api-table span{font-size:12px;line-height:1.5;color:#6f6877}.api-language-head{display:flex;justify-content:space-between;align-items:center;margin-top:22px}.api-language-head h3{margin:0;font-size:18px}.api-language-head span{font-size:10px;color:#8a8291}.api-bottom-cta{margin-top:48px;padding:28px 30px;border:1px solid rgba(111,84,232,.20);border-radius:24px;background:linear-gradient(135deg,#fff,#f7f3ff);display:grid;grid-template-columns:1fr auto;gap:24px;align-items:center}.api-bottom-cta h2{font-size:31px;letter-spacing:-.045em;margin:7px 0}.api-bottom-cta p{margin:0;color:#6f6a78}.api-bottom-cta .actions{margin:0;justify-content:flex-end}
  @media(max-width:900px){.api-hero{grid-template-columns:1fr;gap:28px}.api-paths{grid-template-columns:1fr}.api-start-grid,.api-product-grid{grid-template-columns:1fr}.api-reference-shell{grid-template-columns:1fr}.api-toc{position:static;grid-template-columns:repeat(2,minmax(0,1fr));padding-bottom:12px}.api-bottom-cta{grid-template-columns:1fr}.api-bottom-cta .actions{justify-content:flex-start}}
  @media(max-width:560px){.api-docs{padding-left:18px;padding-right:18px}.api-hero{padding-top:52px}.api-hero-copy h1{font-size:48px}.api-section-head{display:block}.api-section-head p{margin-top:12px}.api-toc{grid-template-columns:1fr}.api-code{font-size:10px;padding:13px}.api-demo-result{grid-template-columns:auto 1fr}.api-demo-result code{grid-column:1/-1;justify-self:start;overflow-wrap:anywhere}.api-bottom-cta{padding:22px}}
  </style>
  </main>`;
}
