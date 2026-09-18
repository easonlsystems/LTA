export type V3AiHost = 'grok' | 'perplexity';

interface HostConfig {
  name: string;
  badge: string;
  openUrl: string;
  intro: string;
  steps: string[];
  gate: string;
}

const HOSTS: Record<V3AiHost, HostConfig> = {
  grok: {
    name: 'Grok',
    badge: 'V3 production acceptance',
    openUrl: 'https://grok.com/connectors',
    intro: 'Grok supports user-added Custom connectors. Link2AI uses the same account, source engine, processing units and OAuth security as the existing Claude connection.',
    steps: ['Open Grok Connectors.', 'Choose New Connector, then Custom.', 'Enter the Link2AI MCP server URL shown below.', 'Finish Link2AI OAuth sign-in, then run one real supported-link read.'],
    gate: 'Do not advertise Grok as production-verified until a real Grok account completes OAuth, discovers read_public_link, reads a supported public URL, and returns the correct source content.'
  },
  perplexity: {
    name: 'Perplexity',
    badge: 'V3 compatibility target',
    openUrl: 'https://www.perplexity.ai/',
    intro: 'Perplexity documents Remote custom connectors for eligible paid plans. This page is for real compatibility acceptance, not a production-support claim yet.',
    steps: ['Open Account settings, then Connectors.', 'Choose + Custom connector, then Remote.', 'Name it Link2AI and enter the HTTPS MCP server URL shown below.', 'Finish OAuth if offered, then run one real supported-link read.'],
    gate: 'Perplexity stays a compatibility target until its live client completes Link2AI public-client OAuth without requiring a client secret, discovers the tools, and returns correct source content.'
  }
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>\"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[ch] ?? ch));
}

export function v3AiConnectPage(host: V3AiHost, brand: string, publicBaseUrl: string): string {
  const cfg = HOSTS[host];
  const mcpUrl = new URL('/mcp', publicBaseUrl).toString();
  const steps = cfg.steps.map((step, index) => '<li><b>' + (index + 1) + '</b><span>' + escapeHtml(step) + '</span></li>').join('');
  const title = 'Connect ' + brand + ' to ' + cfg.name;
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><title>' + escapeHtml(title) + '</title><style>' +
    'body{margin:0;background:#f7f6fb;color:#17151f;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif}main{width:min(820px,calc(100% - 32px));margin:56px auto}.brand{font-weight:900;font-size:20px;margin-bottom:40px}.badge{display:inline-block;padding:7px 10px;border-radius:999px;background:#eeeaff;color:#6049c4;font-size:11px;font-weight:850}h1{font-size:clamp(40px,7vw,64px);letter-spacing:-.055em;line-height:1;margin:16px 0}p{color:#6f6877;line-height:1.6}.card{margin-top:28px;padding:26px;background:#fff;border:1px solid rgba(44,39,55,.12);border-radius:24px;box-shadow:0 18px 55px rgba(50,40,85,.08)}ol{list-style:none;padding:0;margin:22px 0;display:grid;gap:12px}li{display:grid;grid-template-columns:32px 1fr;gap:11px;align-items:start}li b{width:32px;height:32px;border-radius:10px;background:#17151f;color:white;display:grid;place-items:center;font-size:12px}li span{padding-top:6px;line-height:1.5}.url{padding:14px;border-radius:14px;background:#f6f4fa;border:1px solid rgba(44,39,55,.1);overflow-wrap:anywhere;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}.btn{display:inline-flex;padding:12px 15px;border-radius:12px;text-decoration:none;font-weight:800;background:#6f54e8;color:white}.btn.alt{background:white;color:#26212e;border:1px solid rgba(44,39,55,.16)}.gate{margin-top:18px;padding:15px 16px;border-radius:15px;background:#fff7ed;border:1px solid rgba(216,142,76,.24);font-size:13px;color:#785532;line-height:1.55}@media(max-width:600px){main{margin:28px auto}.card{padding:20px}h1{font-size:42px}}' +
    '</style></head><body><main><div class="brand">' + escapeHtml(brand) + '</div><span class="badge">' + escapeHtml(cfg.name + ' · ' + cfg.badge) + '</span><h1>' + escapeHtml(title) + '.</h1><p>' + escapeHtml(cfg.intro) + '</p><section class="card"><h2>Setup</h2><ol>' + steps + '</ol><div class="url"><strong>Link2AI MCP server URL</strong><br>' + escapeHtml(mcpUrl) + '</div><div class="actions"><a class="btn" href="' + escapeHtml(cfg.openUrl) + '" target="_blank" rel="noopener">Open ' + escapeHtml(cfg.name) + ' →</a><a class="btn alt" href="/account">Link2AI account</a></div><div class="gate"><strong>Acceptance gate:</strong> ' + escapeHtml(cfg.gate) + '</div></section></main></body></html>';
}
