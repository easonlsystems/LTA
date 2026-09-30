import type { ParsedMediaUrl } from '../media/url.js';
import { Link2AIError } from '../util/errors.js';
import { safeGetBuffer } from '../util/safeHttp.js';
import type { DistributionProfile } from './policy.js';

export const OPENAI_GITHUB_LICENSE_ALLOWLIST=new Set(['CC0-1.0','0BSD','Unlicense']);

export interface OpenAiRightsEvidence{
  platform:'github';
  repository:string;
  spdxId:string;
}

type CacheEntry={evidence:OpenAiRightsEvidence;expiresAt:number};
const repositoryLicenseCache=new Map<string,CacheEntry>();
const CACHE_MS=30*60*1000;

function githubRepository(input:ParsedMediaUrl):{owner:string;repo:string;key:string}{
  if(input.platform!=='github')throw new Link2AIError(
    'PLATFORM_BLOCKED',
    'This source is not available through the ChatGPT distribution of LTA.',
    422,false,{cause_code:'openai_source_not_authorized'}
  );
  const [owner,repo]=input.canonicalMediaId.split('/');
  if(!owner||!repo)throw new Link2AIError('INVALID_URL','GitHub repository identity is missing.',400,false);
  return {owner,repo,key:`${owner.toLowerCase()}/${repo.toLowerCase()}`};
}

export function openAiGitHubLicenseEvidence(
  input:ParsedMediaUrl,
  payload:unknown
):OpenAiRightsEvidence{
  const {key}=githubRepository(input);
  const root=payload&&typeof payload==='object'&&!Array.isArray(payload)?payload as Record<string,unknown>:null;
  const license=root?.license&&typeof root.license==='object'&&!Array.isArray(root.license)
    ? root.license as Record<string,unknown>
    : null;
  const spdxId=typeof license?.spdx_id==='string'?license.spdx_id.trim():'';
  if(!OPENAI_GITHUB_LICENSE_ALLOWLIST.has(spdxId)){
    throw new Link2AIError(
      'PLATFORM_BLOCKED',
      'This GitHub repository does not expose a content license that LTA can use through the ChatGPT distribution.',
      422,false,{
        cause_code:'openai_source_rights_not_verified',
        repository:key,
        detected_spdx_id:spdxId||null
      }
    );
  }
  return {platform:'github',repository:key,spdxId};
}

async function fetchGitHubRepositoryLicense(input:ParsedMediaUrl):Promise<OpenAiRightsEvidence>{
  const {owner,repo,key}=githubRepository(input);
  const cached=repositoryLicenseCache.get(key);
  if(cached&&cached.expiresAt>Date.now())return cached.evidence;
  const endpoint=`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  let response;
  try{
    response=await safeGetBuffer(endpoint,{
      maxBytes:1_000_000,
      timeoutMs:12_000,
      maxRedirects:2,
      userAgent:'LTA/1.3 ChatGPT-rights-check (+https://api-production-0383e.up.railway.app/support)',
      accept:'application/vnd.github+json'
    });
  }catch(error){
    throw new Link2AIError(
      'PLATFORM_BLOCKED',
      'LTA could not verify this GitHub repository content license for ChatGPT.',
      503,true,{
        cause_code:'openai_source_rights_check_unavailable',
        repository:key,
        cause:error instanceof Error?error.name:'network_error'
      }
    );
  }
  let payload:unknown;
  try{payload=JSON.parse(response.bytes.toString('utf8'));}
  catch{
    throw new Link2AIError(
      'PLATFORM_BLOCKED',
      'LTA could not verify this GitHub repository content license for ChatGPT.',
      503,true,{cause_code:'openai_source_rights_check_invalid_response',repository:key}
    );
  }
  const evidence=openAiGitHubLicenseEvidence(input,payload);
  repositoryLicenseCache.set(key,{evidence,expiresAt:Date.now()+CACHE_MS});
  return evidence;
}

export async function assertOpenAiSourceRights(
  input:ParsedMediaUrl,
  profile:DistributionProfile
):Promise<OpenAiRightsEvidence|null>{
  if(profile!=='openai')return null;
  return await fetchGitHubRepositoryLicense(input);
}
