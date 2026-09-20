function esc(value:string){return value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));}

export function developerDocs(baseUrl:string):string{
  const base=baseUrl.replace(/\/$/,'');
  const mcp=base+'/mcp';
  return `<main id="main-content" class="dev-page">
  <section class="dev-hero">
    <span class="badge"><span class="badge-dot"></span>Developers</span>
    <h1>Connect LTA your way.</h1>
    <p>Use Remote MCP inside an AI client, or use a generated API key from your own app.</p>
  </section>

  <section class="dev-grid">
    <article class="dev-card mcp-card" id="mcp">
      <span class="dev-kicker">Remote MCP</span>
      <h2>Use LTA inside an AI client.</h2>
      <p>Add this URL in a client's Custom MCP / connector settings. LTA handles sign-in through OAuth.</p>
      <div class="endpoint-row">
        <code id="mcp-endpoint">${esc(mcp)}</code>
        <button type="button" id="copy-mcp-endpoint">Copy</button>
      </div>
      <div class="client-row">
        <a href="/connect"><strong>Claude</strong><span>Custom Connector →</span></a>
        <div><strong>Grok</strong><span>Custom MCP</span></div>
        <div><strong>Other clients</strong><span>Remote MCP + OAuth</span></div>
      </div>
      <p class="fine">MCP does not use an <code>l2ai_live_…</code> API key.</p>
    </article>

    <article class="dev-card api-card" id="api">
      <span class="dev-kicker">REST API</span>
      <h2>Use LTA from your app.</h2>
      <p>Generate an API key in Account, then use it with the LTA REST API.</p>
      <div class="endpoint-stack">
        <div><span>Base URL</span><code>${esc(base)}</code></div>
        <div><span>Read endpoint</span><code>POST /v1/read</code></div>
        <div><span>Auth</span><code>Authorization: Bearer &lt;API_KEY&gt;</code></div>
      </div>
      <a class="btn purple" href="/account">Generate API key →</a>
    </article>
  </section>

  <section class="dev-note">
    <strong>That’s it.</strong>
    <span>MCP users need the MCP URL. REST API users need an API key.</span>
    <a href="/sources">Supported sources →</a>
  </section>

  <script>(()=>{const b=document.getElementById('copy-mcp-endpoint');const e=document.getElementById('mcp-endpoint');b?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(e?.textContent||'');b.textContent='Copied ✓';setTimeout(()=>b.textContent='Copy',1600);}catch{b.textContent='Copy manually';}});})();</script>
  <style>
  .dev-page{max-width:1120px;margin:0 auto;padding:72px 28px 84px}.dev-hero{max-width:760px;margin-bottom:34px}.dev-hero h1{font-size:clamp(48px,6vw,72px);line-height:.96;letter-spacing:-.06em;margin:18px 0 16px}.dev-hero p{font-size:18px;line-height:1.6;color:#6f6a78;margin:0}.dev-grid{display:grid;grid-template-columns:1.08fr .92fr;gap:16px}.dev-card{border:1px solid rgba(44,39,55,.11);border-radius:24px;background:rgba(255,255,255,.88);padding:26px;box-shadow:0 16px 46px rgba(41,33,62,.055)}.mcp-card{border-color:rgba(111,84,232,.22);background:linear-gradient(145deg,#fff,#f8f5ff)}.dev-kicker{font-size:10px;font-weight:900;letter-spacing:.12em;text-transform:uppercase;color:#6f54e8}.dev-card h2{font-size:30px;letter-spacing:-.045em;margin:10px 0 9px}.dev-card>p{font-size:14px;line-height:1.6;color:#6f6a78}.endpoint-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:9px;margin:18px 0}.endpoint-row code{padding:13px 14px;border-radius:12px;background:#17151f;color:#fff;overflow-wrap:anywhere;font-size:12px}.endpoint-row button{border:0;border-radius:12px;padding:12px 16px;background:#6f54e8;color:#fff;font-weight:850;cursor:pointer}.client-row{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.client-row>a,.client-row>div{display:grid;gap:4px;padding:12px 13px;border:1px solid rgba(44,39,55,.10);border-radius:13px;background:#fff;text-decoration:none}.client-row strong{font-size:12px}.client-row span{font-size:10px;color:#6f6a78}.fine{font-size:11px!important;margin:13px 0 0}.endpoint-stack{display:grid;gap:8px;margin:18px 0}.endpoint-stack>div{padding:12px 13px;border:1px solid rgba(44,39,55,.10);border-radius:13px;background:#faf9fc}.endpoint-stack span{display:block;font-size:10px;font-weight:850;color:#827b89;margin-bottom:5px}.endpoint-stack code{font-size:12px;overflow-wrap:anywhere}.api-card .btn{margin-top:4px}.dev-note{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:16px;padding:16px 18px;border:1px solid rgba(44,39,55,.09);border-radius:16px;background:rgba(255,255,255,.72);font-size:12px}.dev-note span{color:#6f6a78}.dev-note a{margin-left:auto;text-decoration:none;font-weight:850;color:#5d48c5}
  @media(max-width:800px){.dev-grid{grid-template-columns:1fr}.client-row{grid-template-columns:1fr}.dev-note a{margin-left:0}}
  @media(max-width:560px){.dev-page{padding:52px 18px 64px}.dev-hero h1{font-size:48px}.dev-card{padding:20px}.endpoint-row{grid-template-columns:1fr}.endpoint-row button{width:100%}}
  </style>
  </main>`;
}
