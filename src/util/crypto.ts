import crypto from 'node:crypto';

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
