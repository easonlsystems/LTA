export type RedundancyState='redundant'|'conditional'|'single_path';

export interface SourceRoute{
  name:string;
  rootFamily:string;
  conditional?:boolean;
}

export interface SourceRedundancyEntry{
  state:RedundancyState;
  routes:SourceRoute[];
  note:string;
}

// This is an engineering truth table, not marketing copy. A route only counts as
// independent when its root failure domain differs. Retries such as yt-dlp with browser
// impersonation stay inside the same local_extractor family and never count twice.
export const SOURCE_REDUNDANCY={
  youtube_media:{
    state:'redundant',
    routes:[
      {name:'platform transcript',rootFamily:'public:youtube_transcript'},
      {name:'local media + ASR',rootFamily:'local:yt_dlp'},
      {name:'managed media + ASR',rootFamily:'external:media_default',conditional:true}
    ],
    note:'Transcript and media/ASR paths fail independently; managed media is optional.'
  },
  instagram_media:{
    state:'redundant',
    routes:[
      {name:'yt-dlp media + ASR',rootFamily:'local:yt_dlp'},
      {name:'gallery-dl media + ASR',rootFamily:'local:gallery_dl'},
      {name:'managed media + ASR',rootFamily:'external:media_default',conditional:true}
    ],
    note:'Two independent extractor families are available before the optional managed route.'
  },
  instagram_post:{
    state:'redundant',
    routes:[
      {name:'gallery-dl post extraction',rootFamily:'local:gallery_dl'},
      {name:'public HTML fallback',rootFamily:'public:html'}
    ],
    note:'Two different extraction families.'
  },
  tiktok_media:{
    state:'redundant',
    routes:[
      {name:'yt-dlp media + ASR',rootFamily:'local:yt_dlp'},
      {name:'gallery-dl media + ASR',rootFamily:'local:gallery_dl'},
      {name:'managed media + ASR',rootFamily:'external:media_default',conditional:true}
    ],
    note:'Two independent extractor families are available before the optional managed route.'
  },
  tiktok_post:{
    state:'redundant',
    routes:[
      {name:'gallery-dl post extraction',rootFamily:'local:gallery_dl'},
      {name:'public HTML fallback',rootFamily:'public:html'}
    ],
    note:'Two different extraction families.'
  },
  x_post_media:{
    state:'redundant',
    routes:[
      {name:'X structured syndication',rootFamily:'public:x_syndication'},
      {name:'yt-dlp media extractor',rootFamily:'local:yt_dlp'},
      {name:'managed media provider',rootFamily:'external:media_default',conditional:true}
    ],
    note:'Structured X media and local extraction are separate roots.'
  },
  hackernews:{
    state:'redundant',
    routes:[
      {name:'official Firebase API',rootFamily:'official:hn_firebase'},
      {name:'Algolia HN API',rootFamily:'external:hn_algolia'}
    ],
    note:'Official API remains primary; independent search-service API is fallback only.'
  },
  github:{
    state:'conditional',
    routes:[
      {name:'GitHub REST API',rootFamily:'official:github_api'},
      {name:'GitHub public HTML + .diff fallback',rootFamily:'public:github_html',conditional:true}
    ],
    note:'HTML fallback keeps the source readable when the API path fails, but marks discussion structure as partial.'
  },
  bluesky:{
    state:'single_path',
    routes:[{name:'public AppView API',rootFamily:'official:platform_api'}],
    note:'Needs a direct-PDS or other independent complete-source path.'
  },
  reddit:{
    state:'single_path',
    routes:[{name:'approved Reddit OAuth Data API',rootFamily:'official:platform_api'}],
    note:'Do not add scraping as a fake fallback; second route must be compliant.'
  },
  web:{
    state:'single_path',
    routes:[{name:'direct SSRF-safe HTML fetch',rootFamily:'public:html'}],
    note:'Needs an independent rendered/browser retrieval path.'
  },
  pdf:{
    state:'redundant',
    routes:[
      {name:'pdf.js text-layer parser',rootFamily:'local:pdfjs'},
      {name:'Poppler pdftotext parser',rootFamily:'local:poppler'}
    ],
    note:'Two independent text-layer parsers; OCR/visual PDF remains a separate capability.'
  },
  speech_to_text:{
    state:'conditional',
    routes:[
      {name:'Groq ASR',rootFamily:'asr:groq',conditional:true},
      {name:'OpenAI ASR',rootFamily:'asr:openai',conditional:true}
    ],
    note:'The router supports independent ASR vendors; runtime redundancy depends on configuring both.'
  }
} as const satisfies Record<string,SourceRedundancyEntry>;

export function independentRootFamilies(entry:SourceRedundancyEntry):string[]{
  return [...new Set(entry.routes.filter(route=>!route.conditional).map(route=>route.rootFamily))];
}
