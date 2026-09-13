import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** Remove abandoned Link2AI media temp directories left by a killed worker process. */
export async function cleanupStaleTempDirs(maxAgeMs=60*60*1000):Promise<number>{
  const root=os.tmpdir();
  let entries;
  try{entries=await fs.readdir(root,{withFileTypes:true});}catch{return 0;}
  const now=Date.now();let removed=0;
  for(const entry of entries){
    if(!entry.isDirectory()||!entry.name.startsWith('link2ai-'))continue;
    const full=path.join(root,entry.name);
    try{
      const stat=await fs.stat(full);
      if(now-stat.mtimeMs<maxAgeMs)continue;
      await fs.rm(full,{recursive:true,force:true});
      removed++;
    }catch{/* best-effort cleanup; never block worker startup */}
  }
  return removed;
}
