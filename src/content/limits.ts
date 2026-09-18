export type TextContentClass='web'|'discussion'|'github_issue'|'github_pr'|'pdf'|'social';

export const EXTRACTION_LIMITS={
  // V3 completeness limits are intentionally generous enough for long-form source
  // analysis while remaining bounded for memory, storage and third-party API safety.
  web:{tokens:60_000,hardItems:1},
  discussion:{tokens:60_000,hardItems:1_000,maxDepth:8},
  github_issue:{tokens:60_000,hardItems:600},
  github_pr:{tokens:100_000,hardItems:800},
  pdf:{tokens:100_000,maxPages:250},
  social:{tokens:24_000,hardItems:50}
} as const;

// Deterministic, API-free approximation: four Unicode code points per token.
// It is intentionally conservative and stable across platforms and runtimes.
export function estimateTokens(text:string):number{
  const characters=Array.from(text.trim()).length;
  return characters===0?0:Math.ceil(characters/4);
}

export function textUsageUnits(tokenEstimate:number):number{
  return tokenEstimate<=0?0:Math.max(1,Math.ceil(tokenEstimate/2500));
}

export function videoUsageUnits(durationSeconds:number):number{
  return durationSeconds<=0?0:Math.max(1,Math.ceil(durationSeconds/60));
}

export function usageUnitsToLegacySeconds(units:number):number{return Math.max(0,Math.ceil(units))*60;}

export function usageUnitsForOutcome(input:{successful:boolean;kind:'video'|'text';processedDurationSeconds?:number;extractedText?:string}):number{
  if(!input.successful)return 0;
  return input.kind==='video'?videoUsageUnits(input.processedDurationSeconds??0):textUsageUnits(estimateTokens(input.extractedText??''));
}

export interface CompletenessMetadata{
  truncated:boolean;
  truncationReason?:string;
  extractedTokenEstimate:number;
  usageUnits:number;
  itemsAvailable?:number;
  itemsExtracted?:number;
  pagesAvailable?:number;
  pagesExtracted?:number;
  contentSectionsTruncated?:string[];
}

export function boundExtractedText(text:string,contentClass:TextContentClass,extra:Partial<CompletenessMetadata>={}):{text:string;metadata:CompletenessMetadata}{
  const limit=EXTRACTION_LIMITS[contentClass].tokens;
  const chars=Array.from(text.trim());
  const maxChars=limit*4;
  const clipped=chars.length>maxChars?chars.slice(0,maxChars).join('').trimEnd():chars.join('');
  const truncated=Boolean(extra.truncated)||chars.length>maxChars;
  const extractedTokenEstimate=estimateTokens(clipped);
  return {text:clipped,metadata:{
    truncated,
    ...(truncated?{truncationReason:extra.truncationReason??'safe_content_limit'}:{}),
    extractedTokenEstimate,
    usageUnits:textUsageUnits(extractedTokenEstimate),
    ...(extra.itemsAvailable!==undefined?{itemsAvailable:extra.itemsAvailable}:{}),
    ...(extra.itemsExtracted!==undefined?{itemsExtracted:extra.itemsExtracted}:{}),
    ...(extra.pagesAvailable!==undefined?{pagesAvailable:extra.pagesAvailable}:{}),
    ...(extra.pagesExtracted!==undefined?{pagesExtracted:extra.pagesExtracted}:{}),
    ...(extra.contentSectionsTruncated?.length?{contentSectionsTruncated:extra.contentSectionsTruncated}:{})
  }};
}
