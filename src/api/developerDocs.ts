function esc(value:string){return value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));}

export function developerDocs(baseUrl:string):string{
  const base=baseUrl.replace(/\/$/,'');
  const mcp=base+'/mcp';
  return `<main id="main-content" class="signal-subpage signal-dev-page">
  <section class="signal-page-hero"><div class="signal-page-container">
    <p class="signal-page-label">DEVELOPERS</p>
    <h1>Use LTA through MCP or REST.</h1>
    <p>Use Remote MCP inside an AI client, or generate an API key for your own application. These are separate paths; choose the one that matches where LTA runs.</p>
  </div></section>

  <section class="signal-page-section"><div class="signal-page-container">
    <div class="dev-paths">
      <article id="mcp">
        <div class="dev-path-head"><span>REMOTE MCP</span><h2>Inside an AI client</h2><p>LTA handles sign-in through OAuth. You only need the MCP URL.</p></div>
        <div class="dev-endpoint"><span>MCP endpoint</span><div><code id="mcp-endpoint">${esc(mcp)}</code><button type="button" id="copy-mcp-endpoint">Copy</button></div></div>
        <div class="dev-client-list">
          <div><strong>Claude</strong><span>Custom Connector</span><a href="/connect">Setup guide →</a></div>
          <div><strong>Claude Code</strong><span>Remote MCP + OAuth</span><code>claude mcp add --transport http lta ${esc(mcp)}</code></div>
          <div><strong>Codex</strong><span>Remote MCP + OAuth</span><code>codex mcp add lta --url ${esc(mcp)}</code><code>codex mcp login lta</code></div>
          <div><strong>Other compatible clients</strong><span>Custom MCP / OAuth</span></div>
        </div>
        <p class="dev-fine">MCP does not use an <code>l2ai_live_…</code> API key.</p>
      </article>

      <article id="api">
        <div class="dev-path-head"><span>REST API</span><h2>From your own app</h2><p>Generate an API key in Account, then call the LTA API directly.</p></div>
        <div class="dev-api-list">
          <div><span>Base URL</span><code>${esc(base)}</code></div>
          <div><span>Read</span><code>POST /v1/read</code></div>
          <div><span>Auth</span><code>Authorization: Bearer &lt;API_KEY&gt;</code></div>
        </div>
        <a class="signal-primary" href="/account">Generate API key <span aria-hidden="true">↗</span></a>
      </article>
    </div>

    <div class="dev-bottom"><strong>MCP = AI client. REST = your app.</strong><a href="/sources">Check supported sources →</a></div>
  </div></section>

  <script>(()=>{const b=document.getElementById('copy-mcp-endpoint');const e=document.getElementById('mcp-endpoint');b?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(e?.textContent||'');b.textContent='Copied ✓';setTimeout(()=>b.textContent='Copy',1600);}catch{b.textContent='Copy manually';}});})();</script>
  <style>
  .signal-dev-page .signal-page-section{padding-top:0}
  .dev-paths{border-top:1px solid rgba(255,255,255,.11)}
  .dev-paths>article{display:grid;grid-template-columns:minmax(260px,.72fr) minmax(0,1.28fr);gap:54px;padding:34px 0;border-bottom:1px solid rgba(255,255,255,.10)}
  .dev-path-head>span{display:block;margin-bottom:10px;color:#777c89;font:800 9px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.13em}
  .dev-path-head h2{margin:0 0 10px;font-size:26px;line-height:1.15;letter-spacing:-.03em;color:#f3f0e8}
  .dev-path-head p{margin:0;color:#9296a2;font-size:14px;line-height:1.65}
  .dev-endpoint>span,.dev-api-list span{display:block;margin-bottom:8px;color:#777c89;font:800 9px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.10em}
  .dev-endpoint>div{display:grid;grid-template-columns:minmax(0,1fr) auto;border:1px solid rgba(255,255,255,.12);background:#0f121c}
  .dev-endpoint code{padding:14px 15px;color:#d9d5cc;font-size:12px;overflow-wrap:anywhere}
  .dev-endpoint button{border:0;border-left:1px solid rgba(255,255,255,.10);padding:0 18px;background:#8b72ff;color:#fff;font-weight:850;cursor:pointer}
  .dev-client-list{display:grid;grid-template-columns:1fr 1fr;margin-top:18px;border-top:1px solid rgba(255,255,255,.10);border-left:1px solid rgba(255,255,255,.10)}
  .dev-client-list>div{min-width:0;padding:16px;border-right:1px solid rgba(255,255,255,.10);border-bottom:1px solid rgba(255,255,255,.10);background:#0d1018}
  .dev-client-list strong{display:block;font-size:13px}.dev-client-list span{display:block;margin:4px 0 10px;color:#777c89;font-size:11px}
  .dev-client-list code{display:block;margin-top:5px;color:#b8b3aa;font-size:10px;line-height:1.5;overflow-wrap:anywhere}
  .dev-client-list a{color:#c8beff;text-decoration:none;font-size:11px;font-weight:800}
  .dev-fine{margin:12px 0 0;color:#777c89;font-size:11px}.dev-fine code{color:#b8b3aa}
  .dev-api-list{display:grid;border-top:1px solid rgba(255,255,255,.10);margin-bottom:20px}
  .dev-api-list>div{padding:15px 0;border-bottom:1px solid rgba(255,255,255,.10)}
  .dev-api-list code{color:#d8d4cb;font-size:12px;overflow-wrap:anywhere}
  .dev-bottom{display:flex;justify-content:space-between;gap:20px;padding:24px 0;color:#9296a2;font-size:13px}.dev-bottom strong{color:#d8d4cb}.dev-bottom a{color:#c8beff;text-decoration:none;font-weight:800}
  @media(max-width:760px){
    .dev-paths>article{grid-template-columns:1fr;gap:20px;padding:28px 0}
    .dev-client-list{grid-template-columns:1fr}
    .dev-endpoint>div{grid-template-columns:1fr}
    .dev-endpoint button{min-height:46px;border-left:0;border-top:1px solid rgba(255,255,255,.10)}
    .dev-bottom{display:grid}
  }
  </style>
  </main>`;
}
