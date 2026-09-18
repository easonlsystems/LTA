import type { ParsedMediaUrl } from '../media/url.js';
import { parseMediaUrl } from '../media/url.js';
import { Link2AIError } from '../util/errors.js';

function mismatch():never{
  throw new Link2AIError('EXTRACTION_FAILED','The extractor returned metadata for a different media item.',502,true);
}

export function validateResolvedMediaIdentity(input:ParsedMediaUrl,resolvedId:string,resolvedUrl?:string):string{
  if(!resolvedId)mismatch();
  if(!input.canonicalMediaId.startsWith('short_')){
    if(resolvedId!==input.canonicalMediaId)mismatch();
    if(resolvedUrl){
      let parsed:ParsedMediaUrl;try{parsed=parseMediaUrl(resolvedUrl);}catch{mismatch();}
      const mediaIdentityMatches=parsed.kind==='media'||(input.platform==='x'&&parsed.kind==='post');
      if(parsed.platform!==input.platform||!mediaIdentityMatches||parsed.canonicalMediaId!==input.canonicalMediaId)mismatch();
    }
    return resolvedId;
  }
  if(input.platform!=='tiktok'||!resolvedUrl)mismatch();
  let parsed:ParsedMediaUrl;try{parsed=parseMediaUrl(resolvedUrl);}catch{mismatch();}
  if(parsed.platform!=='tiktok'||parsed.kind!=='media'||parsed.canonicalMediaId.startsWith('short_')||parsed.canonicalMediaId!==resolvedId)mismatch();
  return resolvedId;
}
