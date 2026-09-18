import { safeGetBuffer } from '../util/safeHttp.js';
import { runProcess } from '../util/process.js';
import { Link2AIError } from '../util/errors.js';
import { env } from '../config/env.js';
import { clipExternalText, METADATA_LIMITS } from '../media/text.js';
import { parseMediaUrl, type ParsedMediaUrl } from '../media/url.js';
import { runProviderChain } from '../resolvers/providerChain.js';
import { boundExtractedText, estimateTokens, textUsageUnits, type CompletenessMetadata, type TextContentClass } from './limits.js';

const API_PAGE_BYTES=3_000_000;
const INFRA_SOURCE_MAX_BYTES=256_000_000;
const BROWSER_UA='Link2AI/1.2 public-link-reader (+https://api-production-0383e.up.railway.app/support)';

export interface LinkTextPayload{
  platform:ParsedMediaUrl['platform'];
  canonicalMediaId:string;
  sourceUrl:string;
  title?:string;
  creator?:string;
  caption?:string;
  language:string;
  text:string;
  source:'post'|'page';
  completeness:CompletenessMetadata;
}

export interface TextExtractionBudget{maxUsageUnits:number;}

function quotaBudgetError(budget:TextExtractionBudget,context:string,requiredUsageUnits?:number):Link2AIError{
  const exact=Number.isFinite(requiredUsageUnits)&&Number(requiredUsageUnits)>budget.maxUsageUnits?Math.ceil(Number(requiredUsageUnits)):undefined;
  return new Link2AIError(
    'QUOTA_EXCEEDED',
    `This source needs more than your remaining ${budget.maxUsageUnits} processing units. Add processing units and try again; Link2AI will not return an intentionally partial source.`,
    402,false,{
      cause_code:'source_exceeds_remaining_units',
      context,
      remaining_usage_units:budget.maxUsageUnits,
      ...(exact?{required_usage_units:exact,required_usage_units_at_least:exact}:{required_usage_units_at_least:budget.maxUsageUnits+1})
    }
  );
}

function assertCharsWithinBudget(characters:number,budget:TextExtractionBudget|undefined,context:string):void{
  if(!budget)return;
  const units=textUsageUnits(Math.ceil(Math.max(0,characters)/4));
  if(units>budget.maxUsageUnits)throw quotaBudgetError(budget,context);
}

function assertTextWithinBudget(text:string,budget:TextExtractionBudget|undefined,context:string):void{
  if(!budget)return;
  const requiredUnits=textUsageUnits(estimateTokens(text));
  if(requiredUnits>budget.maxUsageUnits)throw quotaBudgetError(budget,context,requiredUnits);
}

function sourceByteBudget(_budget:TextExtractionBudget|undefined,_floorBytes:number):{maxBytes:number;quotaBounded:boolean}{
  // Raw source bytes are not billable text and can be inflated by images, markup,
  // fonts or metadata. Never infer "not enough units" from raw byte size.
  return {maxBytes:INFRA_SOURCE_MAX_BYTES,quotaBounded:false};
}

async function safeGetForBudget(url:string,opts:{floorBytes:number;timeoutMs:number;maxRedirects?:number;userAgent?:string;accept?:string},budget:TextExtractionBudget|undefined,_context:string){
  const bytes=sourceByteBudget(budget,opts.floorBytes);
  return await safeGetBuffer(url,{maxBytes:bytes.maxBytes,timeoutMs:opts.timeoutMs,maxRedirects:opts.maxRedirects,userAgent:opts.userAgent,accept:opts.accept});
}

function complete(payload:Omit<LinkTextPayload,'completeness'>,contentClass:TextContentClass,extra:Partial<CompletenessMetadata>={},budget?:TextExtractionBudget):LinkTextPayload{
  assertTextWithinBudget(payload.text,budget,`${contentClass}_content`);
  const bounded=boundExtractedText(payload.text,contentClass,extra);
  return {...payload,text:bounded.text,completeness:bounded.metadata};
}

function decodeEntities(value:string):string{
  const named:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',ndash:'–',mdash:'—',hellip:'…',laquo:'«',raquo:'»'};
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi,(_m,entity:string)=>{
    const e=entity.toLowerCase();
    if(e.startsWith('#x')){const n=parseInt(e.slice(2),16);return Number.isFinite(n)?String.fromCodePoint(n):_m;}
    if(e.startsWith('#')){const n=parseInt(e.slice(1),10);return Number.isFinite(n)?String.fromCodePoint(n):_m;}
    return named[e]??_m;
  });
}

export function resolveRedditShareCandidate(input:ParsedMediaUrl,finalUrl:string,html=''):ParsedMediaUrl{
  if(input.platform!=='reddit'||!input.canonicalMediaId.startsWith('share_'))return input;
  const candidates=[finalUrl];
  for(const tag of html.match(/<(?:link|meta)\b[^>]*>/gi)??[]){
    const attrs=new Map<string,string>();
    for(const match of tag.matchAll(/([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(["'])(.*?)\2/g)){
      attrs.set(match[1].toLowerCase(),decodeEntities(match[3]));
    }
    const rel=(attrs.get('rel')??'').toLowerCase().split(/\s+/);
    const property=(attrs.get('property')??attrs.get('name')??'').toLowerCase();
    if(rel.includes('canonical')){const href=attrs.get('href');if(href)candidates.push(href);}
    if(property==='og:url'){const content=attrs.get('content');if(content)candidates.push(content);}
  }
  for(const candidate of candidates){
    try{
      const resolved=parseMediaUrl(candidate);
      if(resolved.platform==='reddit'&&!resolved.canonicalMediaId.startsWith('share_'))return resolved;
    }catch{/* Ignore non-canonical candidates and try the next one. */}
  }
  throw new Link2AIError('EXTRACTION_FAILED','Reddit share link could not be resolved to a public post.',502,true);
}

export async function resolveRedditSharePost(input:ParsedMediaUrl):Promise<ParsedMediaUrl>{
  if(input.platform!=='reddit'||!input.canonicalMediaId.startsWith('share_'))return input;
  // Opaque /s/ tokens are not Reddit post IDs and the approved Data API does not
  // provide a supported token-to-post lookup. Do not scrape/impersonate around that
  // boundary: ask for the canonical /comments/<post_id>/ URL instead.
  throw new Link2AIError(
    'UNSUPPORTED_URL',
    'This Reddit share URL is opaque. Open the post and use its canonical /comments/ URL.',
    422,false,{cause_code:'reddit_opaque_share_url'}
  );
}

function cleanText(value:string,max=Number.MAX_SAFE_INTEGER):string{
  const text=decodeEntities(value)
    .replace(/\r/g,'')
    .replace(/[ \t]+/g,' ')
    .replace(/ *\n */g,'\n')
    .replace(/\n{3,}/g,'\n\n')
    .trim();
  return Array.from(text).slice(0,max).join('');
}

function stripHtml(html:string):string{
  return cleanText(html
    .replace(/<script\b[\s\S]*?<\/script>/gi,' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi,' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi,' ')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi,' ')
    .replace(/<br\s*\/?\s*>/gi,'\n')
    .replace(/<\/(p|div|section|article|main|li|h[1-6]|blockquote|pre)>/gi,'\n')
    .replace(/<li\b[^>]*>/gi,'• ')
    .replace(/<[^>]+>/g,' '));
}

function attrValue(tag:string,name:string):string|undefined{
  const m=tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,'i'));
  const v=m?.[1]??m?.[2]??m?.[3];
  return v?decodeEntities(v).trim():undefined;
}

function metaContent(html:string,names:string[]):string|undefined{
  const wanted=new Set(names.map(v=>v.toLowerCase()));
  const tags=html.match(/<meta\b[^>]*>/gi)??[];
  for(const tag of tags){
    const key=(attrValue(tag,'property')??attrValue(tag,'name')??attrValue(tag,'itemprop')??'').toLowerCase();
    if(!wanted.has(key))continue;
    const content=attrValue(tag,'content');
    if(content)return cleanText(content,METADATA_LIMITS.description);
  }
  return undefined;
}

function extractElement(html:string,tag:string):string|undefined{
  const re=new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`,'i');
  return re.exec(html)?.[1];
}

function pageTextFromHtml(html:string):{title?:string;creator?:string;description?:string;language:string;text:string}{
  const title=metaContent(html,['og:title','twitter:title'])??cleanText(extractElement(html,'title')??'',METADATA_LIMITS.title)??undefined;
  const description=metaContent(html,['og:description','twitter:description','description']);
  const creator=metaContent(html,['author','article:author','twitter:creator']);
  const langTag=html.match(/<html\b[^>]*>/i)?.[0]??'';
  const language=(attrValue(langTag,'lang')??'und').slice(0,32);

  let body=html
    .replace(/<!--[\s\S]*?-->/g,' ')
    .replace(/<(nav|footer|header|aside|form|dialog)\b[\s\S]*?<\/\1>/gi,' ');
  const article=extractElement(body,'article');
  const main=extractElement(body,'main');
  const bodyElement=extractElement(body,'body');
  const candidates=[article,main,bodyElement,body].filter((v):v is string=>Boolean(v)).map(stripHtml);
  let text=candidates.sort((a,b)=>b.length-a.length)[0]??'';
  if(description&&text.length<description.length)text=description;
  if(text.length<80)throw new Link2AIError('EXTRACTION_FAILED','This public page did not expose enough readable text.',422,false);
  return {title:clipExternalText(title,METADATA_LIMITS.title),creator:clipExternalText(creator,METADATA_LIMITS.creator),description:clipExternalText(description,METADATA_LIMITS.description),language,text:cleanText(text)};
}

async function fetchPage(input:ParsedMediaUrl,budget?:TextExtractionBudget):Promise<LinkTextPayload>{
  const response=await safeGetForBudget(input.normalizedUrl,{floorBytes:8_000_000,timeoutMs:15_000,maxRedirects:5,userAgent:BROWSER_UA,accept:'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.2'},budget,'web_response');
  const ct=(response.contentType??'').toLowerCase();
  if(ct&&!ct.includes('text/html')&&!ct.includes('application/xhtml+xml')&&!ct.includes('text/plain')){
    throw new Link2AIError('UNSUPPORTED_URL','This link is not a readable public HTML/text page.',415,false);
  }
  const html=response.bytes.toString('utf8');
  const doc=pageTextFromHtml(html);
  return complete({platform:input.platform,canonicalMediaId:input.canonicalMediaId,sourceUrl:response.finalUrl,title:doc.title,creator:doc.creator,caption:doc.description,language:doc.language,text:doc.text,source:input.kind==='post'?'post':'page'},input.kind==='post'?'social':'web',{},budget);
}

type XOEmbedData={html:string;author_name?:string};

async function fetchXOEmbedData(input:ParsedMediaUrl):Promise<XOEmbedData>{
  const canonical=input.normalizedUrl.replace(/^https:\/\/(?:www\.)?x\.com\//,'https://twitter.com/');
  const endpoint=`https://publish.x.com/oembed?omit_script=1&dnt=true&url=${encodeURIComponent(canonical)}`;
  const response=await safeGetBuffer(endpoint,{maxBytes:1_000_000,timeoutMs:12_000,maxRedirects:3,userAgent:BROWSER_UA,accept:'application/json'});
  let data:any;
  try{data=JSON.parse(response.bytes.toString('utf8'));}catch{throw new Link2AIError('EXTRACTION_FAILED','X returned invalid post metadata.',502,true);}
  return {html:String(data?.html??''),author_name:typeof data?.author_name==='string'?data.author_name:undefined};
}

function xPostText(html:string):string{
  const p=/<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(html)?.[1]??html;
  return stripHtml(p).replace(/\s+pic\.(?:twitter|x)\.com\/\S+$/i,'').trim();
}

async function fetchXPost(input:ParsedMediaUrl,budget?:TextExtractionBudget):Promise<LinkTextPayload>{
  const data=await fetchXOEmbedData(input);
  const text=xPostText(data.html);
  if(!text)throw new Link2AIError('EXTRACTION_FAILED','This X post did not expose readable public text.',422,false);
  return complete({
    platform:'x',canonicalMediaId:input.canonicalMediaId,sourceUrl:input.normalizedUrl,
    title:clipExternalText(`X post by ${String(data.author_name??'').trim()}`,METADATA_LIMITS.title),
    creator:clipExternalText(data.author_name,METADATA_LIMITS.creator),language:'und',text:cleanText(text),source:'post'
  },'social',{},budget);
}

const REDDIT_API_COMMENT_LIMIT=500;
const REDDIT_API_DEPTH=10;

type JsonObject=Record<string,unknown>;

function jsonObject(value:unknown):JsonObject|null{
  return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as JsonObject:null;
}

function jsonString(value:unknown):string{
  return typeof value==='string'?value:'';
}

function jsonNumber(value:unknown):number|undefined{
  return typeof value==='number'&&Number.isFinite(value)?value:undefined;
}

function jsonBoolean(value:unknown):boolean|undefined{return typeof value==='boolean'?value:undefined;}

async function safeJson(url:string,description:string,maxBytes=API_PAGE_BYTES,budget?:TextExtractionBudget):Promise<unknown>{
  const response=budget?await safeGetForBudget(url,{floorBytes:maxBytes,timeoutMs:15_000,maxRedirects:3,userAgent:BROWSER_UA,accept:'application/json'},budget,`${description.toLowerCase().replace(/\s+/g,'_')}_response`):await safeGetBuffer(url,{maxBytes,timeoutMs:15_000,maxRedirects:3,userAgent:BROWSER_UA,accept:'application/json'});
  const ct=(response.contentType??'').toLowerCase();
  if(ct&&!ct.includes('json')&&!ct.includes('javascript')&&!ct.includes('text/plain'))throw new Link2AIError('EXTRACTION_FAILED',`${description} returned a non-JSON response.`,502,true);
  try{return JSON.parse(response.bytes.toString('utf8'));}
  catch{throw new Link2AIError('EXTRACTION_FAILED',`${description} returned malformed JSON.`,502,true);}
}


async function safeJsonArrayPages(url:string,description:string,budget?:TextExtractionBudget):Promise<{items:unknown[];truncated:boolean}>{
  const items:unknown[]=[];
  const perPage=100;
  let page=1;
  while(true){
    const u=new URL(url);
    u.searchParams.set('per_page',String(perPage));
    u.searchParams.set('page',String(page));
    const value=await safeJson(u.toString(),description,API_PAGE_BYTES,budget);
    if(!Array.isArray(value))throw new Link2AIError('EXTRACTION_FAILED',`${description} returned an invalid list.`,502,true);
    items.push(...value);
    if(value.length<perPage)break;
    page++;
  }
  return {items,truncated:false};
}

function isoTimestamp(value:unknown):string{
  if(typeof value!=='string'||!value.trim())return '';
  const time=Date.parse(value);return Number.isFinite(time)?new Date(time).toISOString():'';
}

type BlueskyRendered={lines:string[];count:number};
function collectBlueskyReplies(replies:unknown,out:BlueskyRendered,depth=0):void{
  if(!Array.isArray(replies))return;
  for(const raw of replies){
    const node=jsonObject(raw);const post=jsonObject(node?.post);const record=jsonObject(post?.record);const author=jsonObject(post?.author);
    const text=cleanText(jsonString(record?.text));
    if(text){
      const handle=jsonString(author?.handle)||jsonString(author?.displayName)||'unknown';
      out.lines.push(`${depth?`${'↳'.repeat(depth)} `:''}- @${handle}: ${text}`);
      out.count++;
    }
    collectBlueskyReplies(node?.replies,out,depth+1);
  }
}

export function parseBlueskyThread(input:ParsedMediaUrl,payload:unknown,budget?:TextExtractionBudget):LinkTextPayload{
  const root=jsonObject(payload);const thread=jsonObject(root?.thread);const post=jsonObject(thread?.post);
  const [actor,rkey]=input.canonicalMediaId.split('/');
  if(jsonString(post?.uri)!==`at://${actor}/app.bsky.feed.post/${rkey}`)throw new Link2AIError('EXTRACTION_FAILED','Bluesky returned a different post than requested.',502,true);
  const record=jsonObject(post?.record);const author=jsonObject(post?.author);
  const text=cleanText(jsonString(record?.text));
  if(!text)throw new Link2AIError('EXTRACTION_FAILED','This Bluesky post did not expose readable public text.',422,false);
  const display=jsonString(author?.displayName).trim();const handle=jsonString(author?.handle).trim();
  const sections=[`Post by ${display||handle}${display&&handle?` (@${handle})`:''}`,isoTimestamp(record?.createdAt)?`Published: ${isoTimestamp(record?.createdAt)}`:'',text];
  const embed=jsonObject(post?.embed);const external=jsonObject(embed?.external);
  if(external){
    const card=[jsonString(external.title),jsonString(external.description),jsonString(external.uri)].filter(Boolean).join('\n');
    if(card)sections.push(`External card:\n${cleanText(card)}`);
  }
  const quoted=jsonObject(embed?.record);const quotedValue=jsonObject(quoted?.value);const quotedAuthor=jsonObject(quoted?.author);
  if(quotedValue&&jsonString(quotedValue.text))sections.push(`Quoted post${jsonString(quotedAuthor?.handle)?` by @${jsonString(quotedAuthor?.handle)}`:''}:\n${cleanText(jsonString(quotedValue.text))}`);
  const parent=jsonObject(thread?.parent);const parentPost=jsonObject(parent?.post);const parentRecord=jsonObject(parentPost?.record);
  if(parentRecord&&jsonString(parentRecord.text))sections.push(`Direct parent/replied-to post:\n${cleanText(jsonString(parentRecord.text))}`);
  const replies:BlueskyRendered={lines:[],count:0};collectBlueskyReplies(thread?.replies,replies,0);
  if(replies.lines.length)sections.push(`Public replies (${replies.lines.length} entries):\n${replies.lines.join('\n')}`);
  const repliesAvailable=jsonNumber(post?.replyCount);const repliesTruncated=repliesAvailable!==undefined&&replies.count<repliesAvailable;
  return complete({platform:'bluesky',canonicalMediaId:input.canonicalMediaId,sourceUrl:input.normalizedUrl,title:clipExternalText(`Bluesky post by ${display||handle}`,METADATA_LIMITS.title),creator:clipExternalText(handle?`@${handle}`:display,METADATA_LIMITS.creator),caption:clipExternalText(text,METADATA_LIMITS.description),language:jsonString(record?.langs instanceof Array?record.langs[0]:undefined)||'und',text:cleanText(sections.filter(Boolean).join('\n\n')),source:'post'},'social',{itemsAvailable:repliesAvailable,itemsExtracted:replies.count,truncated:repliesTruncated,contentSectionsTruncated:repliesTruncated?['upstream_replies']:undefined},budget);
}

async function fetchBlueskyPost(input:ParsedMediaUrl,budget?:TextExtractionBudget):Promise<LinkTextPayload>{
  const [actor,rkey]=input.canonicalMediaId.split('/');
  const uri=`at://${actor}/app.bsky.feed.post/${rkey}`;
  const data=await safeJson(`https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(uri)}&depth=1000&parentHeight=1`,'Bluesky',API_PAGE_BYTES,budget);
  return parseBlueskyThread(input,data,budget);
}

export function parseGitHubDiscussion(input:ParsedMediaUrl,itemValue:unknown,commentsValue:unknown,reviewsValue:unknown=[],diff='',sourceTruncated=false,budget?:TextExtractionBudget):LinkTextPayload{
  const item=jsonObject(itemValue);if(!item)throw new Link2AIError('EXTRACTION_FAILED','GitHub returned invalid issue metadata.',502,true);
  const expectedNumber=Number(input.canonicalMediaId.split('/')[3]);
  if(jsonNumber(item.number)!==expectedNumber)throw new Link2AIError('EXTRACTION_FAILED','GitHub returned a different issue or pull request than requested.',502,true);
  const repo=input.canonicalMediaId.split('/').slice(0,2).join('/');const isPr=input.canonicalMediaId.includes('/pull/');
  const user=jsonObject(item.user);const labels=Array.isArray(item.labels)?item.labels.map(v=>jsonString(jsonObject(v)?.name)).filter(Boolean).slice(0,20):[];
  const sections=[`${isPr?'Pull request':'Issue'}: ${repo}#${jsonNumber(item.number)??''}`,`Title: ${jsonString(item.title)}`,`Author: @${jsonString(user?.login)}`,`State: ${jsonString(item.state)}${jsonBoolean(item.merged)===true?' (merged)':''}`,labels.length?`Labels: ${labels.join(', ')}`:'',jsonString(item.created_at)?`Created: ${isoTimestamp(item.created_at)}`:''];
  if(isPr){const base=jsonObject(item.base),head=jsonObject(item.head);sections.push(`Branches: ${jsonString(base?.ref)} ← ${jsonString(head?.ref)}`);}
  if(jsonString(item.body).trim())sections.push(`Body:\n${cleanText(jsonString(item.body))}`);
  const contentClass=isPr?'github_pr':'github_issue';
  const allDiscussion=[...(Array.isArray(commentsValue)?commentsValue:[]),...(Array.isArray(reviewsValue)?reviewsValue:[])];
  const discussionCandidates=allDiscussion.map(value=>{
    const comment=jsonObject(value);const author=jsonObject(comment?.user);const body=cleanText(jsonString(comment?.body));if(!body)return '';
    const timestamp=isoTimestamp(comment?.created_at)||isoTimestamp(comment?.submitted_at);
    const path=jsonString(comment?.path);const line=jsonNumber(comment?.line)??jsonNumber(comment?.original_line);
    const location=path?` · ${path}${line!==undefined?`:${line}`:''}`:'';
    return `@${jsonString(author?.login)||'unknown'}${timestamp?` · ${timestamp}`:''}${location}: ${body}`;
  }).filter(Boolean);
  if(discussionCandidates.length)sections.push(`Public discussion (${discussionCandidates.length} entries):\n${discussionCandidates.join('\n\n')}`);
  if(isPr&&diff.trim())sections.push(`Pull request diff:\n${cleanText(diff)}`);
  const rawText=cleanText(sections.filter(Boolean).join('\n\n'));
  const title=jsonString(item.title);return complete({platform:'github',canonicalMediaId:input.canonicalMediaId,sourceUrl:jsonString(item.html_url)||input.normalizedUrl,title:clipExternalText(title,METADATA_LIMITS.title),creator:clipExternalText(jsonString(user?.login),METADATA_LIMITS.creator),caption:clipExternalText(jsonString(item.body),METADATA_LIMITS.description),language:'und',text:rawText,source:'post'},contentClass,{itemsAvailable:allDiscussion.length,itemsExtracted:discussionCandidates.length,truncated:sourceTruncated,contentSectionsTruncated:sourceTruncated?['upstream_discussion']:undefined},budget);
}

async function fetchGitHubDiscussion(input:ParsedMediaUrl,budget?:TextExtractionBudget):Promise<LinkTextPayload>{
  const [owner,repo,type,number]=input.canonicalMediaId.split('/');const apiBase=`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const isPr=type==='pull';
  const item=await safeJson(`${apiBase}/${isPr?'pulls':'issues'}/${number}`,'GitHub',API_PAGE_BYTES,budget);
  const commentsPage=await safeJsonArrayPages(`${apiBase}/issues/${number}/comments`,'GitHub comments',budget);
  const reviewsPage=isPr?await safeJsonArrayPages(`${apiBase}/pulls/${number}/reviews`,'GitHub reviews',budget):{items:[] as unknown[],truncated:false};
  const reviewCommentsPage=isPr?await safeJsonArrayPages(`${apiBase}/pulls/${number}/comments`,'GitHub inline review comments',budget):{items:[] as unknown[],truncated:false};
  const allFetched=[...commentsPage.items,...reviewsPage.items,...reviewCommentsPage.items];
  const combined=allFetched
    .sort((a,b)=>Date.parse(jsonString(jsonObject(a)?.created_at)||jsonString(jsonObject(a)?.submitted_at)||'')-Date.parse(jsonString(jsonObject(b)?.created_at)||jsonString(jsonObject(b)?.submitted_at)||''));
  const sourceTruncated=commentsPage.truncated||reviewsPage.truncated||reviewCommentsPage.truncated;
  let diff='';if(isPr){const response=await safeGetForBudget(`${apiBase}/pulls/${number}`,{floorBytes:8_000_000,timeoutMs:20_000,maxRedirects:3,userAgent:BROWSER_UA,accept:'application/vnd.github.v3.diff'},budget,'github_diff');diff=response.bytes.toString('utf8');}
  return parseGitHubDiscussion(input,item,combined,[],diff,sourceTruncated,budget);
}

type HnRendered={lines:string[];count:number};
function renderHnComments(children:unknown,depth:number,out:HnRendered):void{
  if(!Array.isArray(children))return;
  for(const value of children){const item=jsonObject(value);if(!item)continue;out.count++;const text=stripHtml(jsonString(item.text));if(text){out.lines.push(`${depth?`${'↳'.repeat(depth)} `:''}- ${jsonString(item.author)||'unknown'}: ${cleanText(text)}`);}renderHnComments(item.children,depth+1,out);}
}

export function parseHackerNewsItem(input:ParsedMediaUrl,payload:unknown,budget?:TextExtractionBudget):LinkTextPayload{
  const item=jsonObject(payload);if(!item)throw new Link2AIError('EXTRACTION_FAILED','Hacker News returned malformed item data.',502,true);
  if(jsonNumber(item.id)!==Number(input.canonicalMediaId))throw new Link2AIError('EXTRACTION_FAILED','Hacker News returned a different item than requested.',502,true);
  const title=cleanText(jsonString(item.title),METADATA_LIMITS.title);const body=stripHtml(jsonString(item.text));
  if(!title&&!body)throw new Link2AIError('EXTRACTION_FAILED','This Hacker News item is deleted or has no readable public content.',422,false);
  const sections=[title?`Title: ${title}`:'',`Submitter: ${jsonString(item.author)||'unknown'}`,jsonNumber(item.points)!==undefined?`Score: ${jsonNumber(item.points)}`:'',isoTimestamp(item.created_at)?`Published: ${isoTimestamp(item.created_at)}`:'',jsonString(item.url)?`Destination: ${jsonString(item.url)}`:'',body?`Story text:\n${body}`:''];
  const rendered:HnRendered={lines:[],count:0};renderHnComments(item.children,0,rendered);if(rendered.lines.length)sections.push(`Comment tree (${rendered.lines.length} comments):\n${rendered.lines.join('\n')}`);
  const itemsAvailable=jsonNumber(item.children_count);const hnTruncated=itemsAvailable!==undefined&&rendered.count<itemsAvailable;return complete({platform:'hackernews',canonicalMediaId:input.canonicalMediaId,sourceUrl:input.normalizedUrl,title:clipExternalText(title,METADATA_LIMITS.title),creator:clipExternalText(jsonString(item.author),METADATA_LIMITS.creator),caption:clipExternalText(body,METADATA_LIMITS.description),language:'und',text:cleanText(sections.filter(Boolean).join('\n\n')),source:'post'},'discussion',{itemsAvailable,itemsExtracted:rendered.count,truncated:hnTruncated,contentSectionsTruncated:hnTruncated?['upstream_comments']:undefined},budget);
}

function hackerNewsOfficialItem(value:unknown,children:unknown[]):JsonObject{
  const item=jsonObject(value);
  if(!item)throw new Link2AIError('EXTRACTION_FAILED','Hacker News returned malformed item data.',502,true);
  const seconds=jsonNumber(item.time);
  return {
    id:jsonNumber(item.id),
    title:jsonString(item.title),
    author:jsonString(item.by),
    points:jsonNumber(item.score),
    created_at:seconds!==undefined?new Date(seconds*1000).toISOString():'',
    url:jsonString(item.url),
    text:jsonString(item.text),
    children,
    children_count:jsonNumber(item.descendants)
  };
}

async function fetchHackerNewsOfficialTree(itemId:string,budget?:TextExtractionBudget):Promise<unknown>{
  const endpoint=(id:number|string)=>`https://hacker-news.firebaseio.com/v0/item/${id}.json`;
  const rootValue=await safeJson(endpoint(itemId),'Hacker News official API',API_PAGE_BYTES,budget);
  const root=jsonObject(rootValue);
  if(!root||jsonNumber(root.id)!==Number(itemId))throw new Link2AIError('EXTRACTION_FAILED','Hacker News did not expose this item through its official API.',422,false);

  const rawById=new Map<number,JsonObject>();
  const childrenById=new Map<number,number[]>();
  const rootId=Number(itemId);
  rawById.set(rootId,root);
  const rootKids=Array.isArray(root.kids)?root.kids.map(jsonNumber).filter((v):v is number=>v!==undefined):[];
  childrenById.set(rootId,rootKids);

  const seen=new Set<number>([rootId]);
  const queue:number[]=[];
  for(const id of rootKids){if(!seen.has(id)){seen.add(id);queue.push(id);}}
  const batchSize=16;
  while(queue.length){
    const ids=queue.splice(0,batchSize);
    const values=await Promise.all(ids.map(id=>safeJson(endpoint(id),'Hacker News official API',API_PAGE_BYTES,budget)));
    for(let i=0;i<ids.length;i++){
      const id=ids[i];
      const item=jsonObject(values[i]);
      if(!item||jsonNumber(item.id)!==id)continue;
      rawById.set(id,item);
      const kids=Array.isArray(item.kids)?item.kids.map(jsonNumber).filter((v):v is number=>v!==undefined):[];
      childrenById.set(id,kids);
      for(const kid of kids){if(!seen.has(kid)){seen.add(kid);queue.push(kid);}}
    }
  }

  const building=new Set<number>();
  const build=(id:number):JsonObject|null=>{
    const item=rawById.get(id);if(!item)return null;
    if(building.has(id))return null;
    building.add(id);
    const children=(childrenById.get(id)??[]).map(build).filter((v):v is JsonObject=>Boolean(v));
    building.delete(id);
    return hackerNewsOfficialItem(item,children);
  };
  return build(rootId)??hackerNewsOfficialItem(root,[]);
}

async function fetchHackerNewsItem(input:ParsedMediaUrl,budget?:TextExtractionBudget):Promise<LinkTextPayload>{
  return parseHackerNewsItem(input,await fetchHackerNewsOfficialTree(input.canonicalMediaId,budget),budget);
}

export async function parsePdfBuffer(input:ParsedMediaUrl,bytes:Buffer,contentType:string|null,budget?:TextExtractionBudget):Promise<LinkTextPayload>{
  const ct=(contentType??'').toLowerCase();
  if(!bytes.subarray(0,1024).includes(Buffer.from('%PDF-')))throw new Link2AIError('UNSUPPORTED_URL','The document response did not have a valid PDF signature.',415,false);
  if(ct&&!ct.includes('pdf')&&!ct.includes('octet-stream'))throw new Link2AIError('UNSUPPORTED_URL','The document response did not use a PDF content type.',415,false);
  try{
    const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
    const document=await pdfjs.getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:false}).promise;
    const pages:string[]=[];let usedChars=0;
    for(let pageNumber=1;pageNumber<=document.numPages;pageNumber++){
      const page=await document.getPage(pageNumber);const content=await page.getTextContent();
      const text=cleanText(content.items.map((v:any)=>typeof v.str==='string'?v.str:'').join(' '));
      if(text){const rendered=`[Page ${pageNumber}]\n${text}`;usedChars+=Array.from(rendered).length+2;assertCharsWithinBudget(usedChars,budget,'pdf_text');pages.push(rendered);}
      page.cleanup();
    }
    const text=cleanText(pages.join('\n\n'));if(!text)throw new Link2AIError('EXTRACTION_FAILED','This PDF has no readable text layer; OCR is not enabled.',422,false);
    const metadata=await document.getMetadata().catch(()=>({info:{}} as any));const info=jsonObject(metadata.info);const title=clipExternalText(jsonString(info?.Title),METADATA_LIMITS.title);
    const pagesAvailable=document.numPages;await document.destroy();return complete({platform:'pdf',canonicalMediaId:input.canonicalMediaId,sourceUrl:input.normalizedUrl,title,caption:`${pagesAvailable} pages`,language:'und',text,source:'page'},'pdf',{pagesAvailable,pagesExtracted:pages.length,truncated:false},budget);
  }catch(error){if(error instanceof Link2AIError)throw error;const message=error instanceof Error?error.message.toLowerCase():'';if(message.includes('password'))throw new Link2AIError('EXTRACTION_FAILED','Password-protected PDFs are not supported.',422,false);throw new Link2AIError('EXTRACTION_FAILED','The PDF was malformed or could not be parsed safely.',422,false);}
}

async function fetchPdf(input:ParsedMediaUrl,budget?:TextExtractionBudget):Promise<LinkTextPayload>{
  const response=await safeGetForBudget(input.normalizedUrl,{floorBytes:24_000_000,timeoutMs:45_000,maxRedirects:5,userAgent:BROWSER_UA,accept:'application/pdf'},budget,'pdf_response');
  return await parsePdfBuffer({...input,normalizedUrl:response.finalUrl},response.bytes,response.contentType,budget);
}

function redditChildren(listing:unknown):unknown[]{
  const root=jsonObject(listing);
  const data=jsonObject(root?.data);
  return Array.isArray(data?.children)?data.children:[];
}

interface RedditCommentLine{
  depth:number;
  author:string;
  body:string;
  score?:number;
}

function collectRedditComments(listing:unknown,out:RedditCommentLine[],depth=0):void{
  for(const childValue of redditChildren(listing)){
    const child=jsonObject(childValue);
    if(child?.kind!=='t1')continue;
    const data=jsonObject(child.data);
    if(!data)continue;
    const rawBody=jsonString(data.body).trim();
    const body=cleanText(rawBody);
    if(body&&body!=='[deleted]'&&body!=='[removed]'){
      const rawAuthor=jsonString(data.author).trim();
      out.push({
        depth,
        author:rawAuthor&&rawAuthor!=='[deleted]'?rawAuthor:'unknown',
        body,
        score:jsonNumber(data.score)
      });
    }
    const replies=data.replies;
    if(replies&&typeof replies==='object')collectRedditComments(replies,out,depth+1);
  }
}

export function parseRedditJson(input:ParsedMediaUrl,payload:unknown,budget?:TextExtractionBudget):LinkTextPayload{
  if(!Array.isArray(payload)||payload.length<1)throw new Link2AIError('EXTRACTION_FAILED','Reddit returned an unexpected public-post response.',502,true);
  const postChild=redditChildren(payload[0]).map(jsonObject).find(child=>child?.kind==='t3');
  const post=jsonObject(postChild?.data);
  if(!post)throw new Link2AIError('EXTRACTION_FAILED','Reddit did not expose this public post.',422,false);
  if(jsonString(post.id).toLowerCase()!==input.canonicalMediaId.toLowerCase())throw new Link2AIError('EXTRACTION_FAILED','Reddit returned a different post than requested.',502,true);

  const title=cleanText(jsonString(post.title),METADATA_LIMITS.title);
  const authorRaw=jsonString(post.author).trim();
  const author=authorRaw&&authorRaw!=='[deleted]'?authorRaw:'unknown';
  const subreddit=jsonString(post.subreddit_name_prefixed).trim()||((jsonString(post.subreddit).trim())?`r/${jsonString(post.subreddit).trim()}`:'');
  const selftext=cleanText(jsonString(post.selftext));
  const externalUrl=jsonString(post.url).trim();
  const permalink=jsonString(post.permalink).trim();
  const numComments=jsonNumber(post.num_comments);
  const comments:RedditCommentLine[]=[];
  if(payload.length>1)collectRedditComments(payload[1],comments);

  const header=[
    subreddit?`Community: ${subreddit}`:'',
    title?`Title: ${title}`:'',
    `Author: u/${author}`
  ].filter(Boolean).join('\n');
  const sections=[header];
  if(selftext&&selftext!=='[deleted]'&&selftext!=='[removed]')sections.push(`Post text:\n${selftext}`);
  const isSelf=post.is_self===true;
  if(!isSelf&&externalUrl&&/^https:\/\//i.test(externalUrl)&&!externalUrl.includes('reddit.com/comments/')){
    sections.push(`Linked URL: ${externalUrl}`);
  }
  if(comments.length){
    const rendered:string[]=[];
    for(const comment of comments){
      const indent='  '.repeat(comment.depth);
      const score=comment.score===undefined?'':` · score ${comment.score}`;
      rendered.push(`${indent}- u/${comment.author}${score}: ${comment.body}`);
    }
    sections.push(`Public comments returned by Reddit at fetch time (${rendered.length}):\n${rendered.join('\n')}`);
  }
  let text=cleanText(sections.join('\n\n'));
  if(text.length<40)throw new Link2AIError('EXTRACTION_FAILED','This Reddit post did not expose enough readable public text.',422,false);

  const sourceUrl=permalink.startsWith('/')?`https://www.reddit.com${permalink}`:input.normalizedUrl;
  const captionParts=[subreddit,selftext].filter(Boolean);
  return complete({
    platform:'reddit',canonicalMediaId:input.canonicalMediaId,sourceUrl,
    title:clipExternalText(title,METADATA_LIMITS.title),
    creator:clipExternalText(`u/${author}`,METADATA_LIMITS.creator),
    caption:clipExternalText(captionParts.join(' · '),METADATA_LIMITS.description),
    language:'und',text,source:'post'
  },'discussion',{itemsAvailable:numComments,itemsExtracted:comments.length,truncated:numComments!==undefined&&comments.length<numComments,contentSectionsTruncated:numComments!==undefined&&comments.length<numComments?['upstream_comments']:undefined},budget);
}

type RedditTokenCache={accessToken:string;expiresAt:number};
let redditTokenCache:RedditTokenCache|undefined;

export function redditOAuthConfigured():boolean{
  const e=env();
  return Boolean(e.REDDIT_CLIENT_ID?.trim()&&e.REDDIT_CLIENT_SECRET?.trim());
}

async function redditAccessToken(force=false):Promise<string>{
  const e=env();
  const clientId=e.REDDIT_CLIENT_ID?.trim();
  const clientSecret=e.REDDIT_CLIENT_SECRET?.trim();
  if(!clientId||!clientSecret){
    throw new Link2AIError(
      'PLATFORM_BLOCKED',
      'Reddit reads are temporarily unavailable while approved Reddit Data API access is being configured.',
      503,false,{cause_code:'reddit_oauth_not_configured',transport:'reddit_oauth'}
    );
  }
  if(!force&&redditTokenCache&&redditTokenCache.expiresAt>Date.now()+60_000)return redditTokenCache.accessToken;
  const auth=Buffer.from(`${clientId}:${clientSecret}`,'utf8').toString('base64');
  let response:Response;
  try{
    response=await fetch('https://www.reddit.com/api/v1/access_token',{
      method:'POST',
      headers:{'authorization':`Basic ${auth}`,'content-type':'application/x-www-form-urlencoded','user-agent':e.REDDIT_USER_AGENT},
      body:'grant_type=client_credentials',
      signal:AbortSignal.timeout(12_000)
    });
  }catch(error){
    throw new Link2AIError('EXTRACTION_FAILED','Reddit OAuth could not be reached.',502,true,{transport:'reddit_oauth',cause_code:error instanceof Error?error.name:'network_error'});
  }
  const body=(await response.text()).slice(0,64_000);
  if(!response.ok){
    const retryable=response.status===429||response.status>=500;
    throw new Link2AIError(
      response.status===429?'RATE_LIMITED':'PLATFORM_BLOCKED',
      retryable?'Reddit OAuth is temporarily unavailable.':'Reddit OAuth credentials were rejected or are not approved for this access.',
      response.status===429?429:503,retryable,{transport:'reddit_oauth',cause_code:`oauth_http_${response.status}`}
    );
  }
  let payload:any;
  try{payload=JSON.parse(body);}catch{throw new Link2AIError('EXTRACTION_FAILED','Reddit OAuth returned malformed JSON.',502,true,{transport:'reddit_oauth',cause_code:'oauth_invalid_json'});}
  const token=typeof payload?.access_token==='string'?payload.access_token:'';
  const expiresIn=Number(payload?.expires_in??3600);
  if(!token)throw new Link2AIError('PLATFORM_BLOCKED','Reddit OAuth did not issue an access token.',503,false,{transport:'reddit_oauth',cause_code:'oauth_missing_token'});
  redditTokenCache={accessToken:token,expiresAt:Date.now()+Math.max(60,Math.min(3600,Number.isFinite(expiresIn)?expiresIn:3600))*1000};
  return token;
}

async function redditOAuthJson(postId:string,budget?:TextExtractionBudget,retry401=true):Promise<unknown>{
  const token=await redditAccessToken(!retry401);
  const e=env();
  const endpoint=`https://oauth.reddit.com/comments/${encodeURIComponent(postId)}?raw_json=1&limit=${REDDIT_API_COMMENT_LIMIT}&depth=${REDDIT_API_DEPTH}&sort=top`;
  let response:Response;
  try{
    response=await fetch(endpoint,{headers:{'authorization':`Bearer ${token}`,'accept':'application/json','user-agent':e.REDDIT_USER_AGENT},signal:AbortSignal.timeout(15_000)});
  }catch(error){
    throw new Link2AIError('EXTRACTION_FAILED','Reddit Data API could not be reached.',502,true,{transport:'reddit_oauth',cause_code:error instanceof Error?error.name:'network_error'});
  }
  if(response.status===401&&retry401){redditTokenCache=undefined;return await redditOAuthJson(postId,budget,false);}
  if(response.status===404)throw new Link2AIError('MEDIA_NOT_FOUND','This Reddit post was not found or is no longer public.',404,false,{transport:'reddit_oauth',cause_code:'reddit_http_404'});
  if(response.status===403)throw new Link2AIError('PLATFORM_BLOCKED','Reddit did not permit this app to access the requested public post.',403,false,{transport:'reddit_oauth',cause_code:'reddit_http_403'});
  if(response.status===429)throw new Link2AIError('RATE_LIMITED','Reddit rate-limited this request. Try again later.',429,true,{transport:'reddit_oauth',cause_code:'reddit_http_429'});
  if(!response.ok)throw new Link2AIError('EXTRACTION_FAILED',`Reddit Data API returned HTTP ${response.status}.`,502,response.status>=500,{transport:'reddit_oauth',cause_code:`reddit_http_${response.status}`});
  const responseBudget=sourceByteBudget(budget,API_PAGE_BYTES);
  const declared=Number(response.headers.get('content-length')??0);
  if(Number.isFinite(declared)&&declared>responseBudget.maxBytes){if(responseBudget.quotaBounded)throw quotaBudgetError(budget!,'reddit_response');throw new Link2AIError('EXTRACTION_FAILED','Reddit response exceeded the infrastructure safety envelope.',502,false,{transport:'reddit_oauth',cause_code:'response_too_large'});}
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length>responseBudget.maxBytes){if(responseBudget.quotaBounded)throw quotaBudgetError(budget!,'reddit_response');throw new Link2AIError('EXTRACTION_FAILED','Reddit response exceeded the infrastructure safety envelope.',502,false,{transport:'reddit_oauth',cause_code:'response_too_large'});}
  const ct=(response.headers.get('content-type')??'').toLowerCase();
  if(ct&&!ct.includes('json'))throw new Link2AIError('EXTRACTION_FAILED','Reddit Data API returned a non-JSON response.',502,true,{transport:'reddit_oauth',cause_code:`non_json_${response.status}`});
  try{return JSON.parse(bytes.toString('utf8'));}
  catch{throw new Link2AIError('EXTRACTION_FAILED','Reddit Data API returned malformed JSON.',502,true,{transport:'reddit_oauth',cause_code:'invalid_json'});}
}

async function fetchRedditPost(input:ParsedMediaUrl,budget?:TextExtractionBudget):Promise<LinkTextPayload>{
  if(!redditOAuthConfigured()){
    throw new Link2AIError(
      'PLATFORM_BLOCKED',
      'Reddit reads are temporarily unavailable while approved Reddit Data API access is being configured.',
      503,false,{cause_code:'reddit_oauth_not_configured',transport:'reddit_oauth'}
    );
  }
  return parseRedditJson(input,await redditOAuthJson(input.canonicalMediaId,budget),budget);
}

function collectGalleryCandidates(node:unknown,out:{texts:string[];creators:string[];titles:string[]}):void{
  if(Array.isArray(node)){for(const item of node)collectGalleryCandidates(item,out);return;}
  if(!node||typeof node!=='object')return;
  const obj=node as Record<string,unknown>;
  for(const key of ['description','content','caption','post_text']){
    const v=obj[key];if(typeof v==='string'&&v.trim().length>=2)out.texts.push(v);
  }
  for(const key of ['username','user','author','uploader','owner']){
    const v=obj[key];
    if(typeof v==='string'&&v.trim())out.creators.push(v);
    else if(v&&typeof v==='object'){
      const n=(v as Record<string,unknown>).username??(v as Record<string,unknown>).name??(v as Record<string,unknown>).nick;
      if(typeof n==='string'&&n.trim())out.creators.push(n);
    }
  }
  for(const key of ['title','post_shortcode','shortcode']){const v=obj[key];if(typeof v==='string'&&v.trim())out.titles.push(v);}
  for(const v of Object.values(obj))if(v&&typeof v==='object')collectGalleryCandidates(v,out);
}

async function fetchGalleryPost(input:ParsedMediaUrl,budget?:TextExtractionBudget):Promise<LinkTextPayload>{
  let result;
  try{
    result=await runProcess('gallery-dl',['--no-input','--no-colors','--simulate','--dump-json',input.normalizedUrl],{timeoutMs:30_000,maxOutputBytes:sourceByteBudget(budget,8_000_000).maxBytes});
  }catch{
    throw new Link2AIError('EXTRACTION_FAILED','The primary social-post provider did not return readable content.',502,true,{cause_code:'gallery_dl_process_failed'});
  }
  if(result.code!==0||!result.stdout.trim()){
    throw new Link2AIError('EXTRACTION_FAILED','The primary social-post provider did not return readable content.',502,true,{cause_code:'gallery_dl_empty'});
  }
  let data:unknown;
  try{data=JSON.parse(result.stdout);}catch{
    // Newer gallery-dl can emit JSONL; tolerate that mode too.
    try{data=result.stdout.split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));}
    catch{throw new Link2AIError('EXTRACTION_FAILED','The primary social-post provider returned invalid metadata.',502,true,{cause_code:'gallery_dl_invalid_json'});}
  }
  const found={texts:[] as string[],creators:[] as string[],titles:[] as string[]};
  collectGalleryCandidates(data,found);
  const unique=[...new Set(found.texts.map(v=>cleanText(v)).filter(Boolean))];
  const text=unique.sort((a,b)=>b.length-a.length)[0]??'';
  if(!text)throw new Link2AIError('EXTRACTION_FAILED','The primary social-post provider did not expose readable post text.',502,true,{cause_code:'gallery_dl_no_text'});
  const creator=[...new Set(found.creators.map(v=>cleanText(v,METADATA_LIMITS.creator)).filter(Boolean))][0];
  const title=[...new Set(found.titles.map(v=>cleanText(v,METADATA_LIMITS.title)).filter(Boolean))][0];
  return complete({platform:input.platform,canonicalMediaId:input.canonicalMediaId,sourceUrl:input.normalizedUrl,title,creator,caption:clipExternalText(text,METADATA_LIMITS.description),language:'und',text,source:'post'},'social',{},budget);
}

export async function extractTextLink(input:ParsedMediaUrl,budget?:TextExtractionBudget):Promise<LinkTextPayload>{
  if(input.kind==='media')throw new Link2AIError('INTERNAL_ERROR','Media links must use the media extraction pipeline.',500);
  if(input.platform==='x')return await fetchXPost(input,budget);
  if(input.platform==='reddit')return await fetchRedditPost(input,budget);
  if(input.platform==='bluesky')return await fetchBlueskyPost(input,budget);
  if(input.platform==='github')return await fetchGitHubDiscussion(input,budget);
  if(input.platform==='hackernews')return await fetchHackerNewsItem(input,budget);
  if(input.platform==='pdf')return await fetchPdf(input,budget);
  if(input.platform==='instagram'||input.platform==='tiktok'){
    return await runProviderChain<LinkTextPayload>({
      platform:input.platform,operation:'text',
      attempts:[
        {name:'gallery_dl',run:()=>fetchGalleryPost(input,budget)},
        {name:'public_page',run:()=>fetchPage(input,budget)}
      ]
    });
  }
  return await fetchPage(input,budget);
}
