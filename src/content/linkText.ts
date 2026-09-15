import { safeGetBuffer } from '../util/safeHttp.js';
import { runProcess } from '../util/process.js';
import { Link2AIError } from '../util/errors.js';
import { clipExternalText, METADATA_LIMITS } from '../media/text.js';
import type { ParsedMediaUrl } from '../media/url.js';

const PAGE_MAX_BYTES=2_500_000;
const PAGE_MAX_CHARS=80_000;
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

function cleanText(value:string,max=PAGE_MAX_CHARS):string{
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

async function fetchPage(input:ParsedMediaUrl):Promise<LinkTextPayload>{
  const response=await safeGetBuffer(input.normalizedUrl,{maxBytes:PAGE_MAX_BYTES,timeoutMs:15_000,maxRedirects:5,userAgent:BROWSER_UA,accept:'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.2'});
  const ct=(response.contentType??'').toLowerCase();
  if(ct&&!ct.includes('text/html')&&!ct.includes('application/xhtml+xml')&&!ct.includes('text/plain')){
    throw new Link2AIError('UNSUPPORTED_URL','This link is not a readable public HTML/text page.',415,false);
  }
  const html=response.bytes.toString('utf8');
  const doc=pageTextFromHtml(html);
  return {platform:input.platform,canonicalMediaId:input.canonicalMediaId,sourceUrl:response.finalUrl,title:doc.title,creator:doc.creator,caption:doc.description,language:doc.language,text:doc.text,source:input.kind==='post'?'post':'page'};
}

function xPostText(html:string):string{
  const p=/<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(html)?.[1]??html;
  return stripHtml(p).replace(/\s+pic\.x\.com\/\S+$/i,'').trim();
}

async function fetchXPost(input:ParsedMediaUrl):Promise<LinkTextPayload>{
  const canonical=input.normalizedUrl.replace(/^https:\/\/(?:www\.)?x\.com\//,'https://twitter.com/');
  const endpoint=`https://publish.x.com/oembed?omit_script=1&dnt=true&url=${encodeURIComponent(canonical)}`;
  const response=await safeGetBuffer(endpoint,{maxBytes:1_000_000,timeoutMs:12_000,maxRedirects:3,userAgent:BROWSER_UA,accept:'application/json'});
  let data:any;
  try{data=JSON.parse(response.bytes.toString('utf8'));}catch{throw new Link2AIError('EXTRACTION_FAILED','X returned invalid post metadata.',502,true);}
  const text=xPostText(String(data?.html??''));
  if(!text)throw new Link2AIError('EXTRACTION_FAILED','This X post did not expose readable public text.',422,false);
  return {
    platform:'x',canonicalMediaId:input.canonicalMediaId,sourceUrl:input.normalizedUrl,
    title:clipExternalText(`X post by ${String(data?.author_name??'').trim()}`,METADATA_LIMITS.title),
    creator:clipExternalText(data?.author_name,METADATA_LIMITS.creator),language:'und',text:cleanText(text),source:'post'
  };
}

const REDDIT_MAX_COMMENTS=40;
const REDDIT_MAX_DEPTH=4;

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
  if(depth>REDDIT_MAX_DEPTH||out.length>=REDDIT_MAX_COMMENTS)return;
  for(const childValue of redditChildren(listing)){
    if(out.length>=REDDIT_MAX_COMMENTS)return;
    const child=jsonObject(childValue);
    if(child?.kind!=='t1')continue;
    const data=jsonObject(child.data);
    if(!data)continue;
    const rawBody=jsonString(data.body).trim();
    const body=cleanText(rawBody,4_000);
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

export function parseRedditJson(input:ParsedMediaUrl,payload:unknown):LinkTextPayload{
  if(!Array.isArray(payload)||payload.length<1)throw new Link2AIError('EXTRACTION_FAILED','Reddit returned an unexpected public-post response.',502,true);
  const postChild=redditChildren(payload[0]).map(jsonObject).find(child=>child?.kind==='t3');
  const post=jsonObject(postChild?.data);
  if(!post)throw new Link2AIError('EXTRACTION_FAILED','Reddit did not expose this public post.',422,false);

  const title=cleanText(jsonString(post.title),METADATA_LIMITS.title);
  const authorRaw=jsonString(post.author).trim();
  const author=authorRaw&&authorRaw!=='[deleted]'?authorRaw:'unknown';
  const subreddit=jsonString(post.subreddit_name_prefixed).trim()||((jsonString(post.subreddit).trim())?`r/${jsonString(post.subreddit).trim()}`:'');
  const selftext=cleanText(jsonString(post.selftext),20_000);
  const externalUrl=jsonString(post.url).trim();
  const permalink=jsonString(post.permalink).trim();
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
    const rendered=comments.map(comment=>{
      const indent='  '.repeat(Math.min(comment.depth,REDDIT_MAX_DEPTH));
      const score=comment.score===undefined?'':` · score ${comment.score}`;
      return `${indent}- u/${comment.author}${score}: ${comment.body}`;
    }).join('\n');
    sections.push(`Top public comments (up to ${REDDIT_MAX_COMMENTS}, Reddit ordering at fetch time):\n${rendered}`);
  }
  let text=cleanText(sections.join('\n\n'));
  if(text.length<40)throw new Link2AIError('EXTRACTION_FAILED','This Reddit post did not expose enough readable public text.',422,false);
  if(text.length>PAGE_MAX_CHARS)text=cleanText(text,PAGE_MAX_CHARS);

  const sourceUrl=permalink.startsWith('/')?`https://www.reddit.com${permalink}`:input.normalizedUrl;
  const captionParts=[subreddit,selftext].filter(Boolean);
  return {
    platform:'reddit',canonicalMediaId:input.canonicalMediaId,sourceUrl,
    title:clipExternalText(title,METADATA_LIMITS.title),
    creator:clipExternalText(`u/${author}`,METADATA_LIMITS.creator),
    caption:clipExternalText(captionParts.join(' · '),METADATA_LIMITS.description),
    language:'und',text,source:'post'
  };
}

async function fetchRedditPost(input:ParsedMediaUrl):Promise<LinkTextPayload>{
  const id=encodeURIComponent(input.canonicalMediaId);
  const endpoints=[
    `https://www.reddit.com/comments/${id}.json?raw_json=1&limit=${REDDIT_MAX_COMMENTS}&depth=${REDDIT_MAX_DEPTH}&sort=top`,
    `https://old.reddit.com/comments/${id}.json?raw_json=1&limit=${REDDIT_MAX_COMMENTS}&depth=${REDDIT_MAX_DEPTH}&sort=top`
  ];
  let lastError:unknown;
  for(const endpoint of endpoints){
    try{
      const response=await safeGetBuffer(endpoint,{maxBytes:3_000_000,timeoutMs:15_000,maxRedirects:3,userAgent:BROWSER_UA,accept:'application/json,text/json;q=0.9'});
      const ct=(response.contentType??'').toLowerCase();
      if(ct&&!ct.includes('json')&&!ct.includes('javascript')&&!ct.includes('text/plain'))throw new Link2AIError('EXTRACTION_FAILED','Reddit returned a non-JSON response.',502,true);
      let data:unknown;
      try{data=JSON.parse(response.bytes.toString('utf8'));}
      catch{throw new Link2AIError('EXTRACTION_FAILED','Reddit returned invalid public-post JSON.',502,true);}
      return parseRedditJson(input,data);
    }catch(error){lastError=error;}
  }
  // Final fallback for temporary JSON endpoint blocks. It is intentionally text-only;
  // private/login-gated posts should still fail the minimum-readable-text checks.
  try{
    const fallback=await fetchPage({...input,normalizedUrl:`https://old.reddit.com/comments/${id}/`});
    const lower=fallback.text.toLowerCase();
    if(lower.includes('private community')||lower.includes('you must be logged in')||lower.includes('log in to continue')){
      throw new Link2AIError('LOGIN_REQUIRED','This Reddit post requires login or community access.',403,false);
    }
    return {...fallback,platform:'reddit',source:'post',canonicalMediaId:input.canonicalMediaId};
  }catch{
    if(lastError instanceof Link2AIError)throw lastError;
    throw new Link2AIError('EXTRACTION_FAILED','Reddit could not expose this public post right now.',502,true);
  }
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

async function fetchGalleryPost(input:ParsedMediaUrl):Promise<LinkTextPayload|null>{
  let result;
  try{
    result=await runProcess('gallery-dl',['--no-input','--no-colors','--simulate','--dump-json',input.normalizedUrl],{timeoutMs:20_000,maxOutputBytes:4_000_000});
  }catch{return null;}
  if(result.code!==0||!result.stdout.trim())return null;
  let data:unknown;
  try{data=JSON.parse(result.stdout);}catch{
    // Newer gallery-dl can emit JSONL; tolerate that mode too.
    try{data=result.stdout.split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));}catch{return null;}
  }
  const found={texts:[] as string[],creators:[] as string[],titles:[] as string[]};
  collectGalleryCandidates(data,found);
  const unique=[...new Set(found.texts.map(v=>cleanText(v,METADATA_LIMITS.description)).filter(Boolean))];
  const text=unique.sort((a,b)=>b.length-a.length)[0]??'';
  if(!text)return null;
  const creator=[...new Set(found.creators.map(v=>cleanText(v,METADATA_LIMITS.creator)).filter(Boolean))][0];
  const title=[...new Set(found.titles.map(v=>cleanText(v,METADATA_LIMITS.title)).filter(Boolean))][0];
  return {platform:input.platform,canonicalMediaId:input.canonicalMediaId,sourceUrl:input.normalizedUrl,title,creator,caption:text,language:'und',text,source:'post'};
}

export async function extractTextLink(input:ParsedMediaUrl):Promise<LinkTextPayload>{
  if(input.kind==='media')throw new Link2AIError('INTERNAL_ERROR','Media links must use the media extraction pipeline.',500);
  if(input.platform==='x')return await fetchXPost(input);
  if(input.platform==='reddit')return await fetchRedditPost(input);
  if(input.platform==='instagram'||input.platform==='tiktok'){
    const gallery=await fetchGalleryPost(input);
    if(gallery)return gallery;
  }
  return await fetchPage(input);
}
