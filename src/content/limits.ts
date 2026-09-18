export type TextContentClass='web'|'discussion'|'github_issue'|'github_pr'|'pdf'|'social';

// Deterministic, API-free approximation: four Unicode code points per token.
// It is intentionally conservative and stable across platforms and runtimes.
export function estimateTokens(text:string):number{
  const characters=Array.from(text.trim()).length;
  return characters===0?0:Math.ceil(characters/4);
}

export const TEXT_TOKENS_PER_UNIT=2500;
export const ESTIMATED_CHARS_PER_TOKEN=4;

export function textUsageUnits(tokenEstimate:number):number{
  return tokenEstimate<=0?0:Math.max(1,Math.ceil(tokenEstimate/TEXT_TOKENS_PER_UNIT));
}

export function textCharacterBudget(usageUnits:number):number{
  return Math.max(0,Math.floor(usageUnits))*TEXT_TOKENS_PER_UNIT*ESTIMATED_CHARS_PER_TOKEN;
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

export function boundExtractedText(text:string,_contentClass:TextContentClass,extra:Partial<CompletenessMetadata>={}):{text:string;metadata:CompletenessMetadata}{
  // V3 does not truncate a supported text source to a product-defined content cap.
  // The caller enforces the user's available processing-unit budget instead.
  const fullText=text.trim();
  const truncated=Boolean(extra.truncated);
  const extractedTokenEstimate=estimateTokens(fullText);
  return {text:fullText,metadata:{
    truncated,
    ...(truncated?{truncationReason:extra.truncationReason??'upstream_incomplete'}:{}),
    extractedTokenEstimate,
    usageUnits:textUsageUnits(extractedTokenEstimate),
    ...(extra.itemsAvailable!==undefined?{itemsAvailable:extra.itemsAvailable}:{}),
    ...(extra.itemsExtracted!==undefined?{itemsExtracted:extra.itemsExtracted}:{}),
    ...(extra.pagesAvailable!==undefined?{pagesAvailable:extra.pagesAvailable}:{}),
    ...(extra.pagesExtracted!==undefined?{pagesExtracted:extra.pagesExtracted}:{}),
    ...(extra.contentSectionsTruncated?.length?{contentSectionsTruncated:extra.contentSectionsTruncated}:{})
  }};
}
