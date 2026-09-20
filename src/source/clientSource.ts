export type ClientSource='claude'|'grok'|'chatgpt'|'kimi'|'rest_api'|'mcp'|'legacy';

export function normalizeClientSource(value:unknown):ClientSource{
  const source=String(value??'').trim().toLowerCase();
  if(source==='claude'||source==='grok'||source==='chatgpt'||source==='kimi'||source==='rest_api'||source==='mcp'||source==='legacy')return source;
  return 'mcp';
}

export function inferMcpClientSource(clientId:unknown,userAgent:unknown,profile:unknown='default'):ClientSource{
  if(String(profile??'').toLowerCase()==='openai')return 'chatgpt';
  const haystack=`${String(clientId??'')} ${String(userAgent??'')}`.toLowerCase();
  if(/claude|anthropic/.test(haystack))return 'claude';
  if(/\bgrok\b|x\.ai|xai/.test(haystack))return 'grok';
  if(/chatgpt|openai/.test(haystack))return 'chatgpt';
  if(/\bkimi\b|moonshot/.test(haystack))return 'kimi';
  return 'mcp';
}

export function clientSourceLabel(value:unknown):string{
  const source=normalizeClientSource(value);
  return ({
    claude:'Claude',
    grok:'Grok',
    chatgpt:'ChatGPT',
    kimi:'Kimi',
    rest_api:'REST API',
    mcp:'Other MCP',
    legacy:'Legacy / unknown'
  } as Record<ClientSource,string>)[source];
}
