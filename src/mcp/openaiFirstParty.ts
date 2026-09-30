import { McpServer, type AuthInfo } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { getUsageSnapshot } from '../quota/service.js';
import { parseMediaUrl, type Platform } from '../media/url.js';
import { textUsageUnits, videoUsageUnits } from '../content/limits.js';
import { env } from '../config/env.js';
import { generalAudienceBlockReason } from '../safety/generalAudience.js';
import { OPENAI_FIRST_PARTY_SKILL_DESCRIPTION, OPENAI_FIRST_PARTY_SKILL_MD, OPENAI_FIRST_PARTY_SKILL_NAME, OPENAI_FIRST_PARTY_SKILL_URI, openAiFirstPartySkillEntry } from './openaiFirstPartySkill.js';

const OAUTH_SECURITY=[{type:'oauth2' as const,scopes:['link2ai:read']}];

type HandlerContext={http?:{authInfo?:AuthInfo & {extra?:{userId?:unknown}}}};

function userIdFromContext(ctx:HandlerContext):string{
  const id=ctx?.http?.authInfo?.extra?.userId;
  if(typeof id!=='string'||!id)throw new Error('Authenticated LTA user is missing.');
  return id;
}

function toolResponse(data:Record<string,unknown>,isError=false){
  return {
    content:[{type:'text' as const,text:JSON.stringify(data)}],
    structuredContent:data,
    ...(isError?{isError:true}:{})
  };
}

function sourceName(platform:Platform):string{
  switch(platform){
    case 'youtube': return 'YouTube video / Short';
    case 'instagram': return 'Instagram Reel / post';
    case 'tiktok': return 'TikTok video / supported post';
    case 'x': return 'X post';
    case 'reddit': return 'Reddit exact post';
    case 'bluesky': return 'Bluesky post';
    case 'github': return 'GitHub Issue / pull request';
    case 'hackernews': return 'Hacker News item / discussion';
    case 'pdf': return 'Public text-layer PDF';
    case 'web': return 'Readable public webpage / article';
  }
}

const supportOutputSchema=z.object({
  status:z.enum(['recognized','unsupported','blocked']),
  source_type:z.string().optional(),
  source_kind:z.enum(['media','post','page','document']).optional(),
  currently_supported_by_lta:z.boolean(),
  directory_content_access:z.literal(false),
  network_request_made:z.literal(false),
  message:z.string()
});

const sourceCatalogOutputSchema=z.object({
  source_types:z.array(z.object({
    platform:z.string(),
    label:z.string(),
    currently_available:z.boolean(),
    note:z.string().optional()
  })),
  directory_content_access:z.literal(false),
  message:z.string()
});

const unitEstimateOutputSchema=z.object({
  status:z.enum(['estimated','invalid_input']),
  content_kind:z.enum(['video','text']),
  estimated_processing_units:z.number().int().nonnegative().optional(),
  basis:z.string(),
  message:z.string()
});

const usageOutputSchema=z.object({
  plan:z.enum(['trial','basic','pro']),
  used_usage_units:z.number().int().nonnegative(),
  limit_usage_units:z.number().int().nonnegative(),
  remaining_usage_units:z.number().int().nonnegative(),
  period_end:z.string().nullable().optional()
});

function registerCanonicalToolsList(server:McpServer):void{
  const sdkServer=server as any;
  server.server.setRequestHandler('tools/list',(async()=>{
    const registered=sdkServer._registeredTools as Record<string,any>;
    const tools=Object.entries(registered)
      .filter(([,tool])=>tool?.enabled)
      .map(([name,tool])=>{
        const securitySchemes=tool?._meta?.securitySchemes;
        const definition:Record<string,unknown>={
          name,
          ...(tool.title!==undefined?{title:tool.title}:{}),
          ...(tool.description!==undefined?{description:tool.description}:{}),
          inputSchema:sdkServer.toolInputSchemaJson(name)??{type:'object',properties:{}},
          ...(tool.outputSchemaJson!==undefined?{outputSchema:tool.outputSchemaJson}:{}),
          ...(tool.annotations!==undefined?{annotations:tool.annotations}:{}),
          ...(tool.icons!==undefined?{icons:tool.icons}:{}),
          ...(tool.execution!==undefined?{execution:tool.execution}:{}),
          ...(tool._meta!==undefined?{_meta:tool._meta}:{}),
          ...(securitySchemes!==undefined?{securitySchemes}:{})
        };
        return definition;
      });
    return {tools};
  }) as any);
}

function registerSkill(server:McpServer):void{
  server.registerResource(
    OPENAI_FIRST_PARTY_SKILL_NAME,
    OPENAI_FIRST_PARTY_SKILL_URI,
    {
      title:'Use LTA account and planning tools',
      description:OPENAI_FIRST_PARTY_SKILL_DESCRIPTION,
      mimeType:'text/markdown'
    },
    async uri=>({
      contents:[{uri:uri.href,mimeType:'text/markdown',text:OPENAI_FIRST_PARTY_SKILL_MD}]
    })
  );

  const skillResourceSchema=z.object({
    uri:z.string(),
    digest:z.string().regex(/^sha256:[0-9a-f]{64}$/)
  });
  const skillEntrySchema=z.object({
    uri:z.string(),
    frontmatter:z.object({
      name:z.string(),
      description:z.string()
    }),
    resources:z.array(skillResourceSchema)
  });

  server.server.setRequestHandler(
    'skills/list',
    {
      params:z.object({cursor:z.string().optional()}),
      result:z.object({
        skills:z.array(skillEntrySchema),
        nextCursor:z.string().optional()
      })
    },
    async params=>{
      if(params.cursor)return {skills:[]};
      return {skills:[openAiFirstPartySkillEntry()]};
    }
  );

  server.server.setRequestHandler(
    'skills/get',
    {
      params:z.object({uri:z.string()}),
      result:z.object({skill:skillEntrySchema})
    },
    async params=>{
      if(params.uri!==OPENAI_FIRST_PARTY_SKILL_URI)throw new Error('Unknown LTA skill URI.');
      return {skill:openAiFirstPartySkillEntry()};
    }
  );
}

export function buildOpenAiFirstPartyServer():McpServer{
  const e=env();
  const redditReady=Boolean(e.REDDIT_CLIENT_ID?.trim()&&e.REDDIT_CLIENT_SECRET?.trim());

  const server=new McpServer(
    {name:e.PUBLIC_BRAND_NAME,version:'1.13.0'},
    {
      capabilities:{extensions:{'io.modelcontextprotocol/skills':{}}},
      instructions:`${e.PUBLIC_BRAND_NAME} is the public product name. This public-directory ChatGPT distribution is a first-party LTA account and planning companion. It does not fetch, scrape, proxy, relay, or return content from third-party websites or APIs. Use it only to check whether a user-provided URL matches an LTA-supported source format, inspect LTA's supported-source catalog, estimate LTA processing units from user-provided size/duration, or read the authenticated user's LTA usage balance. A recognized URL does not mean this ChatGPT distribution can read that URL's contents.`
    }
  );

  server.registerTool('check_link_support',{
    title:'Check LTA link support',
    description:'Check locally whether a user-provided HTTPS URL matches an exact source format recognized by LTA. This tool only parses the URL string on LTA infrastructure; it does not contact, fetch, scrape, proxy, or read the linked third-party site or content. Use it for compatibility questions, never for questions that require the contents behind the URL.',
    inputSchema:{url:z.string().url().max(4096).describe('HTTPS URL whose format the user wants LTA to classify')},
    outputSchema:supportOutputSchema.shape,
    securitySchemes:OAUTH_SECURITY,
    _meta:{securitySchemes:OAUTH_SECURITY},
    annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}
  } as any,async(args:Record<string,unknown>)=>{
    const url=String(args.url??'');
    if(generalAudienceBlockReason({sourceUrl:url})){
      return toolResponse({
        status:'blocked',
        currently_supported_by_lta:false,
        directory_content_access:false,
        network_request_made:false,
        message:'This URL is outside the general-audience scope of the public LTA ChatGPT plugin.'
      });
    }
    try{
      const parsed=parseMediaUrl(url);
      const redditAvailable=parsed.platform!=='reddit'||redditReady;
      return toolResponse({
        status:'recognized',
        source_type:sourceName(parsed.platform),
        source_kind:parsed.kind,
        currently_supported_by_lta:redditAvailable,
        directory_content_access:false,
        network_request_made:false,
        message:redditAvailable
          ? 'LTA recognizes this exact source format. This ChatGPT directory plugin does not fetch or read the linked content.'
          : 'LTA recognizes this Reddit post format, but Reddit reads are not currently available on this deployment. This ChatGPT directory plugin does not fetch or read the linked content.'
      });
    }catch{
      return toolResponse({
        status:'unsupported',
        currently_supported_by_lta:false,
        directory_content_access:false,
        network_request_made:false,
        message:'This URL does not match an exact source format currently recognized by LTA.'
      });
    }
  });

  server.registerTool('get_supported_sources',{
    title:'List LTA source support',
    description:'Return LTA\'s first-party source compatibility catalog. This is static/current LTA product capability information and does not contact any listed third-party service or return third-party content.',
    inputSchema:{},
    outputSchema:sourceCatalogOutputSchema.shape,
    securitySchemes:OAUTH_SECURITY,
    _meta:{securitySchemes:OAUTH_SECURITY},
    annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}
  } as any,async()=>{
    const sourceTypes=[
      {platform:'youtube',label:'YouTube videos and Shorts',currently_available:true},
      {platform:'instagram',label:'Instagram Reels and supported public posts',currently_available:true},
      {platform:'tiktok',label:'TikTok videos and supported public posts',currently_available:true},
      {platform:'x',label:'Individual public X posts',currently_available:true},
      {platform:'bluesky',label:'Individual public Bluesky posts',currently_available:true},
      {platform:'github',label:'Public GitHub Issues and pull requests',currently_available:true},
      {platform:'hackernews',label:'Hacker News items and discussions',currently_available:true},
      {platform:'web',label:'Readable public HTTPS webpages and articles',currently_available:true},
      {platform:'pdf',label:'Direct public text-layer PDFs',currently_available:true},
      {
        platform:'reddit',
        label:'Individual public Reddit posts',
        currently_available:redditReady,
        note:redditReady?undefined:'Requires approved Reddit OAuth Data API credentials on the LTA deployment.'
      }
    ];
    return toolResponse({
      source_types:sourceTypes,
      directory_content_access:false,
      message:'These are LTA product source categories. This ChatGPT directory plugin reports compatibility only and does not fetch third-party source content.'
    });
  });

  server.registerTool('estimate_processing_units',{
    title:'Estimate LTA processing units',
    description:'Estimate LTA processing units from a duration or character count supplied by the user. This calculation is local and deterministic: video uses one unit per started minute; text uses one unit per 2,500 estimated tokens with four characters per estimated token. It does not inspect or fetch any external source.',
    inputSchema:{
      content_kind:z.enum(['video','text']),
      duration_seconds:z.number().nonnegative().max(86_400).optional().describe('For video estimates, duration in seconds supplied by the user'),
      character_count:z.number().int().nonnegative().max(100_000_000).optional().describe('For text estimates, character count supplied by the user')
    },
    outputSchema:unitEstimateOutputSchema.shape,
    securitySchemes:OAUTH_SECURITY,
    _meta:{securitySchemes:OAUTH_SECURITY},
    annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}
  } as any,async(args:Record<string,unknown>)=>{
    const kind=args.content_kind==='text'?'text':'video';
    if(kind==='video'){
      const duration=typeof args.duration_seconds==='number'?args.duration_seconds:NaN;
      if(!Number.isFinite(duration)){
        return toolResponse({
          status:'invalid_input',content_kind:'video',
          basis:'1 processing unit per started minute of successfully processed video.',
          message:'Provide duration_seconds to estimate video processing units.'
        });
      }
      const units=videoUsageUnits(duration);
      return toolResponse({
        status:'estimated',content_kind:'video',estimated_processing_units:units,
        basis:'1 processing unit per started minute of successfully processed video.',
        message:`Estimated LTA processing units: ${units}.`
      });
    }

    const characters=typeof args.character_count==='number'?args.character_count:NaN;
    if(!Number.isFinite(characters)){
      return toolResponse({
        status:'invalid_input',content_kind:'text',
        basis:'Four characters per estimated token; 2,500 estimated tokens per processing unit.',
        message:'Provide character_count to estimate text processing units.'
      });
    }
    const estimatedTokens=Math.ceil(characters/4);
    const units=textUsageUnits(estimatedTokens);
    return toolResponse({
      status:'estimated',content_kind:'text',estimated_processing_units:units,
      basis:'Four characters per estimated token; 2,500 estimated tokens per processing unit.',
      message:`Estimated LTA processing units: ${units}.`
    });
  });

  server.registerTool('get_usage',{
    title:`Check ${e.PUBLIC_BRAND_NAME} usage`,
    description:`Return the authenticated user's current ${e.PUBLIC_BRAND_NAME} plan, processing-unit usage, remaining processing units, and allowance period. This reads only first-party LTA account data and does not initiate purchases or return checkout links.`,
    inputSchema:{},
    outputSchema:usageOutputSchema.shape,
    securitySchemes:OAUTH_SECURITY,
    _meta:{securitySchemes:OAUTH_SECURITY},
    annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}
  } as any,async(_args:Record<string,unknown>,ctx:HandlerContext)=>{
    try{
      const usage=await getUsageSnapshot(userIdFromContext(ctx));
      return toolResponse({
        plan:usage.plan,
        used_usage_units:usage.used_usage_units,
        limit_usage_units:usage.limit_usage_units,
        remaining_usage_units:usage.remaining_usage_units,
        period_end:usage.period_end
      });
    }catch{
      return toolResponse({
        status:'failed',
        message:'LTA could not read the account usage right now.'
      },true);
    }
  });

  registerSkill(server);
  registerCanonicalToolsList(server);
  return server;
}
