const PNG_SIGNATURE=Buffer.from([137,80,78,71,13,10,26,10]);

export function imageMimeFromBytes(bytes:Buffer):'image/jpeg'|'image/png'|'image/webp'|'image/gif'|null{
  if(bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return 'image/jpeg';
  if(bytes.length>=8&&bytes.subarray(0,8).equals(PNG_SIGNATURE))return 'image/png';
  if(bytes.length>=6&&(bytes.toString('ascii',0,6)==='GIF87a'||bytes.toString('ascii',0,6)==='GIF89a'))return 'image/gif';
  if(bytes.length>=12&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')return 'image/webp';
  return null;
}
