import { env } from '../config/env.js';
import { runProcess } from '../util/process.js';
import { Link2AIError } from '../util/errors.js';

async function requireBinary(command:string,args:string[],label:string):Promise<void>{
  try{
    const result=await runProcess(command,args,{timeoutMs:10_000,maxOutputBytes:1_000_000});
    if(result.code!==0)throw new Error(result.stderr||result.stdout||`${label} exited ${result.code}`);
  }catch(error){
    if(error instanceof Link2AIError)throw error;
    throw new Link2AIError('INTERNAL_ERROR',`${label} is not available in the worker runtime.`,503,false,{cause:error instanceof Error?error.message:String(error)});
  }
}

export async function assertWorkerRuntime():Promise<void>{
  await requireBinary(env().YTDLP_BIN,['--version'],'yt-dlp');
  await requireBinary(env().FFMPEG_BIN,['-version'],'FFmpeg');
  await requireBinary('python3',['-c','import curl_cffi; print(curl_cffi.__version__)'],'curl_cffi');
}
