export function timelineCoverageVerified(duration:number|undefined,segments:Array<{start:number;end:number}>|undefined):boolean{
  if(!duration||duration<=0||!segments?.length)return false;
  const ordered=[...segments].filter(s=>Number.isFinite(s.start)&&Number.isFinite(s.end)&&s.start>=0&&s.end>s.start).sort((a,b)=>a.start-b.start);
  if(!ordered.length||ordered[0].start>Math.min(10,duration*0.1))return false;
  let end=0;
  for(const segment of ordered){
    if(segment.start-end>Math.min(30,Math.max(5,duration*0.1)))return false;
    end=Math.max(end,segment.end);
  }
  return end>=duration-Math.min(10,duration*0.1);
}
