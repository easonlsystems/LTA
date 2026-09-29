export interface GeneralAudienceInput{
  sourceUrl?:string|null;
  title?:string|null;
  description?:string|null;
  text?:string|null;
  ageLimit?:number|null;
  sensitive?:boolean|null;
}

const ADULT_HOST_RE=/(^|\.)(pornhub\.com|xvideos\.com|xnxx\.com|xhamster\.com|redtube\.com|youporn\.com|spankbang\.com|brazzers\.com|onlyfans\.com)$/i;

const STRONG_TEXT_PATTERNS:RegExp[]=[
  /\b(?:blowjob|handjob|cumshot|creampie|deepthroat|gangbang|hardcore\s+(?:porn|sex)|explicit\s+sex|sex\s+tape|porn\s+(?:video|clip|scene|stream)|masturbation\s+(?:video|clip)|oral\s+sex\s+(?:video|clip)|anal\s+sex\s+(?:video|clip)|onlyfans\s+leaks?)\b/i,
  /(?:成人影片|成人視頻|成人视频|色情影片|色情視頻|色情直播|A片|AV片|無碼|无码|口交影片|內射|内射|顏射|颜射|群交|亂倫|乱伦|自慰影片|情色直播|裸聊)/i,
  /(?:アダルト動画|エロ動画|無修正動画|成人向け動画)/i
];

const WEAK_TEXT_PATTERNS:RegExp[]=[
  /\b(?:porn|pornography|xxx|hentai|nsfw|nudes?|fetish|erotic)\b/i,
  /(?:色情|情色|裸照|裸體|裸体|成人內容|成人内容)/i
];

const ADULT_CONTEXT_RE=/\b(?:watch|video|clip|scene|stream|free|full|leak|gallery|download)\b|(?:影片|視頻|视频|直播|觀看|观看|免費|免费|下載|下载)/i;

function normalizedText(value:unknown):string{
  return String(value??'').normalize('NFKC').replace(/\s+/g,' ').trim();
}

function sourceHost(url:string|undefined|null):string{
  try{return url?new URL(url).hostname.toLowerCase():'';}catch{return '';}
}

export function generalAudienceBlockReason(input:GeneralAudienceInput):string|null{
  const ageLimit=Number(input.ageLimit??0);
  if(Number.isFinite(ageLimit)&&ageLimit>=18)return 'age_restricted_source';
  if(input.sensitive===true)return 'platform_sensitive_media';

  const host=sourceHost(input.sourceUrl);
  if(host&&ADULT_HOST_RE.test(host))return 'adult_content_domain';

  const title=normalizedText(input.title);
  if(/\b(?:18\+|adults?\s+only|explicit\s+adult)\b/i.test(title)||/(?:限18歲|限18岁|成人限定)/i.test(title))return 'adult_only_label';

  const text=[title,normalizedText(input.description),normalizedText(input.text)].filter(Boolean).join(' ');
  if(!text)return null;
  if(STRONG_TEXT_PATTERNS.some(pattern=>pattern.test(text)))return 'explicit_sexual_content';

  const weakHits=WEAK_TEXT_PATTERNS.reduce((count,pattern)=>count+(pattern.test(text)?1:0),0);
  if(weakHits>=2&&ADULT_CONTEXT_RE.test(text))return 'explicit_sexual_content';

  return null;
}
