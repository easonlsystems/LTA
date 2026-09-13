import { Link2AIError } from '../util/errors.js';
import type { TranscriptSegment } from './types.js';
import { safeGetBuffer } from '../util/safeHttp.js';

const MAX_CAPTION_BYTES = 5_000_000;

type CaptionTrack = {url:string; ext?:string; name?:string};

function pickLanguage(map: Record<string, CaptionTrack[]>, requested: string, originalLanguage?: string): [string, CaptionTrack[]] | undefined {
  const entries = Object.entries(map);
  if (!entries.length) return undefined;
  if (requested && requested !== 'auto') {
    const exact = entries.find(([lang]) => lang.toLowerCase() === requested.toLowerCase());
    if (exact) return exact;
    const base = requested.split('-')[0].toLowerCase();
    const prefix = entries.find(([lang]) => lang.toLowerCase().split('-')[0] === base);
    if (prefix) return prefix;
  }

  // In auto mode, prefer the actual/original transcript instead of an auto-translated track.
  // YouTube automatic captions can expose many translated languages, so a static language
  // preference (for example zh before en) can silently return a translation rather than what
  // the speaker said.
  if (!requested || requested === 'auto') {
    const explicitOriginal = entries.find(([lang, tracks]) =>
      /-orig$/i.test(lang) || tracks.some(track => /\boriginal\b/i.test(track.name ?? ''))
    );
    if (explicitOriginal) return explicitOriginal;

    if (originalLanguage) {
      const exact = entries.find(([lang]) => lang.toLowerCase() === originalLanguage.toLowerCase());
      if (exact) return exact;
      const base = originalLanguage.split('-')[0].toLowerCase();
      const prefix = entries.find(([lang]) => lang.toLowerCase().split('-')[0] === base && !/-orig$/i.test(lang));
      if (prefix) return prefix;
    }
  }

  return entries[0];
}

function orderedTracks(tracks: CaptionTrack[]): CaptionTrack[] {
  const supported = tracks.filter(t => !t.ext || ['vtt','json3'].includes(t.ext.toLowerCase()));
  return [...supported].sort((a,b) => {
    const score=(t:CaptionTrack)=>t.ext?.toLowerCase()==='vtt'?0:t.ext?.toLowerCase()==='json3'?1:2;
    return score(a)-score(b);
  });
}

export async function fetchBestCaption(
  subtitles: Record<string, Array<{url:string; ext?:string; name?:string}>>,
  auto: Record<string, Array<{url:string; ext?:string; name?:string}>>,
  requestedLanguage: string,
  originalLanguage?: string
): Promise<{ language: string; transcript: string; segments: TranscriptSegment[] } | null> {
  const selections = [
    pickLanguage(subtitles, requestedLanguage, originalLanguage),
    pickLanguage(auto, requestedLanguage, originalLanguage)
  ].filter((v):v is [string,CaptionTrack[]]=>Boolean(v));

  for (const [language, tracks] of selections) {
    for (const track of orderedTracks(tracks)) {
      try {
        const buf=(await safeGetBuffer(track.url,{maxBytes:MAX_CAPTION_BYTES,timeoutMs:20_000,maxRedirects:5})).bytes;
        const text = buf.toString('utf8');
        const parsed = (track.ext ?? '').toLowerCase() === 'json3' || text.trimStart().startsWith('{')
          ? parseJson3(text, language)
          : parseVtt(text, language);
        if(parsed.transcript)return parsed;
      } catch (error) {
        // A malformed or expired caption track is not a video-level failure. Try the
        // next representation/language and only fall back to ASR after all tracks fail.
        if (error instanceof Link2AIError || error instanceof SyntaxError) continue;
        throw error;
      }
    }
  }
  return null;
}

function cleanText(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(?:39|x27);/gi, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function charOverlap(previous:string,current:string):number{
  // CJK rolling captions often have no whitespace at all. Require at least a
  // two-character overlap so an ordinary repeated single character is not erased.
  const max=Math.min(previous.length,current.length,200);
  for(let n=max;n>=2;n--){
    if(previous.slice(-n)===current.slice(0,n))return n;
  }
  return 0;
}

function joinCueTexts(texts:string[]):string{
  let merged='';
  let previous='';
  let previousWords:string[]=[];
  for(const raw of texts){
    const current=raw.trim();
    if(!current)continue;
    if(!merged){merged=current;previous=current;previousWords=current.split(/\s+/).filter(Boolean);continue;}
    if(current===previous){previous=current;continue;}

    const currentWords=current.split(/\s+/).filter(Boolean);
    const whitespaceMode=/\s/.test(previous)||/\s/.test(current);
    if(!whitespaceMode){
      const overlap=charOverlap(previous,current);
      merged+=current.slice(overlap);
      previous=current;
      previousWords=currentWords;
      continue;
    }

    let overlap=0;
    const max=Math.min(previousWords.length,currentWords.length);
    for(let n=max;n>=1;n--){
      const left=previousWords.slice(-n).join('\u0000').toLowerCase();
      const right=currentWords.slice(0,n).join('\u0000').toLowerCase();
      if(left===right){overlap=n;break;}
    }
    // One-word overlaps are common in rolling captions, but removing them from long
    // independent sentences can erase legitimate repetition. Restrict the one-word
    // case to short/rolling-looking cues.
    if(overlap===1&&previousWords.length>8&&currentWords.length>8)overlap=0;
    const suffix=currentWords.slice(overlap).join(' ');
    if(suffix)merged+=`${/\s$/.test(merged)?'':' '}${suffix}`;
    previous=current;
    previousWords=currentWords;
  }
  return merged.replace(/\s+/g,' ').trim();
}

function timeToSeconds(value: string): number | null {
  const normalized=value.trim().replace(',', '.');
  if(!/^\d{1,3}:\d{2}:\d{2}(?:\.\d+)?$/.test(normalized)&&!/^\d{1,3}:\d{2}(?:\.\d+)?$/.test(normalized))return null;
  const parts = normalized.split(':').map(Number);
  if(parts.some(n=>!Number.isFinite(n)||n<0))return null;
  const minutes=parts.length===3?parts[1]:parts[0];
  const seconds=parts.at(-1)!;
  if(minutes>=60||seconds>=60)return null;
  return parts.length === 3 ? parts[0] * 3600 + minutes * 60 + seconds : minutes * 60 + seconds;
}

export function parseVtt(input: string, language = 'und'): { language: string; transcript: string; segments: TranscriptSegment[] } {
  const blocks = input.replace(/^\uFEFF/, '').split(/\r?\n\r?\n+/);
  const segments: TranscriptSegment[] = [];
  let previous = '';
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const timingIndex = lines.findIndex(l => l.includes('-->'));
    if (timingIndex < 0) continue;
    const [rawStart, rawEnd] = lines[timingIndex].split('-->').map(s => s.trim().split(/\s+/)[0]);
    const start=timeToSeconds(rawStart),end=timeToSeconds(rawEnd);
    if(start===null||end===null||end<=start)continue;
    const text = cleanText(lines.slice(timingIndex + 1).join(' '));
    if (!text || text === previous) continue;
    previous = text;
    segments.push({ start, end, text });
  }
  const transcript = joinCueTexts(segments.map(s => s.text));
  return { language, transcript, segments };
}

export function parseJson3(input: string, language = 'und'): { language: string; transcript: string; segments: TranscriptSegment[] } {
  const data = JSON.parse(input) as { events?: unknown };
  const segments: TranscriptSegment[] = [];
  if(!Array.isArray(data.events))return { language, transcript:'', segments };
  for (const rawEvent of data.events) {
    if(!rawEvent||typeof rawEvent!=='object')continue;
    const event=rawEvent as {tStartMs?:number; dDurationMs?:number; segs?:Array<{utf8?:string}>};
    const text = cleanText((event.segs ?? []).map(s => s.utf8 ?? '').join(''));
    if (!text) continue;
    if(!Number.isFinite(event.tStartMs)||!Number.isFinite(event.dDurationMs)||(event.tStartMs??-1)<0||(event.dDurationMs??0)<=0)continue;
    const start = event.tStartMs! / 1000;
    const end = start + event.dDurationMs! / 1000;
    segments.push({ start, end, text });
  }
  return { language, transcript: joinCueTexts(segments.map(s => s.text)), segments };
}
