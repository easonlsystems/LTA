import { spawn } from 'node:child_process';
import { Link2AIError } from './errors.js';

export async function runProcess(
  command: string,
  args: string[],
  options: { timeoutMs: number; cwd?: string; maxOutputBytes?: number } 
): Promise<{ stdout: string; stderr: string; code: number }> {
  const maxOutputBytes = options.maxOutputBytes ?? 10_000_000;
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let total = 0;
    let killedForSize = false;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, options.timeoutMs);
    const collect = (arr: Buffer[]) => (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxOutputBytes) {
        killedForSize = true;
        child.kill('SIGKILL');
        return;
      }
      arr.push(chunk);
    };
    child.stdout.on('data', collect(stdout));
    child.stderr.on('data', collect(stderr));
    child.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', code => {
      clearTimeout(timer);
      const out = Buffer.concat(stdout).toString('utf8');
      const err = Buffer.concat(stderr).toString('utf8');
      if (killedForSize) {
        reject(new Link2AIError('EXTRACTION_FAILED', 'Process output exceeded the safety limit.', 502, false));
        return;
      }
      if (timedOut) {
        reject(new Link2AIError('EXTRACTION_FAILED', 'Media processing timed out.', 504, true));
        return;
      }
      resolve({ stdout: out, stderr: err, code: code ?? -1 });
    });
  });
}
