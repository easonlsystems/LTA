export function openAiIssuedResourceOverride(
  userAgent:string|undefined,
  requestedResource:string|undefined,
  defaultResource:string,
  openaiResource:string
):string|undefined{
  const ua=String(userAgent??'');
  if(
    /^openai-connectors-oauth\/\d+(?:\.\d+)*$/i.test(ua)&&
    requestedResource===defaultResource&&
    openaiResource!==defaultResource
  ){
    return openaiResource;
  }
  return undefined;
}
