import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(crypto.scrypt) as any;
const PASSWORD_SCRYPT_OPTIONS={N:16_384,r:8,p:1,maxmem:64*1024*1024};

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function randomNumericCode(digits=6):string{
  if(!Number.isInteger(digits)||digits<1||digits>9)throw new RangeError('digits must be an integer from 1 to 9');
  const min=digits===1?0:10**(digits-1);
  const max=10**digits;
  return String(crypto.randomInt(min,max)).padStart(digits,'0');
}

export function sha256(input: string | Buffer): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function hmacSha256(secret: string, input: string): string {
  return crypto.createHmac('sha256', secret).update(input).digest('hex');
}

export function pkceS256(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  try {
    const aa = Buffer.from(a, 'hex');
    const bb = Buffer.from(b, 'hex');
    return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
  } catch {
    return false;
  }
}

export function validateAccountPassword(password:string):void{
  if(password.length<10)throw new Error('Password must be at least 10 characters.');
  if(password.length>128)throw new Error('Password must be 128 characters or fewer.');
}

export async function hashAccountPassword(password:string):Promise<{salt:string;hash:string}>{
  validateAccountPassword(password);
  const salt=crypto.randomBytes(16).toString('base64url');
  const derived=await scryptAsync(password,salt,64,PASSWORD_SCRYPT_OPTIONS);
  return {salt,hash:derived.toString('hex')};
}

export async function verifyAccountPassword(password:string,salt:string,expectedHash:string):Promise<boolean>{
  if(!salt||!expectedHash)return false;
  try{
    const derived=await scryptAsync(password,salt,64,PASSWORD_SCRYPT_OPTIONS);
    return timingSafeEqualHex(derived.toString('hex'),expectedHash);
  }catch{return false;}
}
