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
      {name:'platform transcript',rootFamily:'platform_transcript'},
      {name:'local media + ASR',rootFamily:'local_extractor'},
      {name:'managed media + ASR',rootFamily:'external_provider',conditional:true}
    ],
    note:'Transcript and media/ASR paths fail independently; managed media is optional.'
  },
  instagram_media:{
    state:'conditional',
    routes:[
      {name:'local media + ASR',rootFamily:'local_extractor'},
      {name:'managed media + ASR',rootFamily:'external_provider',conditional:true}
    ],
    note:'Fully redundant only when an independent managed media provider is configured.'
  },
  instagram_post:{
    state:'redundant',
    routes:[
      {name:'gallery-dl post extraction',rootFamily:'local_extractor'},
      {name:'public HTML fallback',rootFamily:'public_html'}
    ],
    note:'Two different extraction families.'
  },
  tiktok_media:{
    state:'conditional',
    routes:[
      {name:'local media + ASR',rootFamily:'local_extractor'},
      {name:'managed media + ASR',rootFamily:'external_provider',conditional:true}
    ],
    note:'Fully redundant only when an independent managed media provider is configured.'
  },
  tiktok_post:{
    state:'redundant',
    routes:[
      {name:'gallery-dl post extraction',rootFamily:'local_extractor'},
      {name:'public HTML fallback',rootFamily:'public_html'}
    ],
    note:'Two different extraction families.'
  },
  x_post_media:{
    state:'redundant',
    routes:[
      {name:'X structured syndication',rootFamily:'public_structured'},
      {name:'local media extractor',rootFamily:'local_extractor'},
      {name:'managed media provider',rootFamily:'external_provider',conditional:true}
    ],
    note:'Structured X media and local extraction are separate roots.'
  },
  hackernews:{
    state:'redundant',
    routes:[
      {name:'official Firebase API',rootFamily:'official_api'},
      {name:'Algolia HN API',rootFamily:'external_provider'}
    ],
    note:'Official API remains primary; independent search-service API is fallback only.'
  },
  github:{
    state:'single_path',
    routes:[{name:'GitHub REST API',rootFamily:'official_api'}],
    note:'Needs an independent fallback that preserves discussion/diff completeness.'
  },
  bluesky:{
    state:'single_path',
    routes:[{name:'public AppView API',rootFamily:'official_api'}],
    note:'Needs a direct-PDS or other independent complete-source path.'
  },
  reddit:{
    state:'single_path',
    routes:[{name:'approved Reddit OAuth Data API',rootFamily:'official_api'}],
    note:'Do not add scraping as a fake fallback; second route must be compliant.'
  },
  web:{
    state:'single_path',
    routes:[{name:'direct SSRF-safe HTML fetch',rootFamily:'public_html'}],
    note:'Needs an independent rendered/browser retrieval path.'
  },
  pdf:{
    state:'single_path',
    routes:[{name:'pdf.js text-layer parser',rootFamily:'local_extractor'}],
    note:'Needs a second parser; OCR/visual PDF remains a separate capability.'
  }
} as const satisfies Record<string,SourceRedundancyEntry>;

export function independentRootFamilies(entry:SourceRedundancyEntry):string[]{
  return [...new Set(entry.routes.filter(route=>!route.conditional).map(route=>route.rootFamily))];
}
