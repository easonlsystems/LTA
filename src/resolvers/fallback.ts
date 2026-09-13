import { asLink2AIError } from '../util/errors.js';

export function shouldTryExternalFallback(err:unknown):boolean{
  const code=asLink2AIError(err).code;
  return code==='EXTRACTION_FAILED'||code==='RATE_LIMITED'||code==='PLATFORM_BLOCKED';
}
