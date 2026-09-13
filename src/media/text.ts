/** Bound untrusted platform metadata before persisting it or returning it to an AI client. */
export function clipExternalText(value:unknown,maxChars:number):string|undefined{
  if(typeof value!=='string')return undefined;
  const cleaned=value.replace(/\u0000/g,'').trim();
  if(!cleaned)return undefined;
  const chars=Array.from(cleaned);
  return chars.length<=maxChars?cleaned:chars.slice(0,maxChars).join('');
}

export const METADATA_LIMITS={
  title:500,
  creator:300,
  description:10_000,
  language:64,
  canonicalId:512,
  subtitleUrl:4096,
  subtitleName:200,
  subtitleExt:32
} as const;
