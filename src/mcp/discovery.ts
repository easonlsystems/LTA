const OPENAI_UNAUTH_DISCOVERY_METHODS=new Set([
  'initialize',
  'notifications/initialized',
  'ping',
  'tools/list',
  'prompts/list',
  'resources/list',
  'resources/templates/list'
]);

function discoveryMethod(value:unknown):string|null{
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const method=(value as Record<string,unknown>).method;
  return typeof method==='string'?method:null;
}

export function isUnauthenticatedMcpDiscoveryRequest(body:unknown):boolean{
  if(Array.isArray(body)){
    return body.length>0&&body.every(item=>{
      const method=discoveryMethod(item);
      return method!==null&&OPENAI_UNAUTH_DISCOVERY_METHODS.has(method);
    });
  }
  const method=discoveryMethod(body);
  return method!==null&&OPENAI_UNAUTH_DISCOVERY_METHODS.has(method);
}
