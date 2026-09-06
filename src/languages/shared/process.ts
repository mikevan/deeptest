/**
 * Small child-process helper. Streams stdout and stderr to a log callback,
 * collects them, and honours an AbortSignal. No shell: arguments are passed
 * as an array so paths with spaces survive on every platform.
 */
import { spawn } from 'node:child_process';

export interface ProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  output: string;
}

export function runProcess(
  command: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv; log?: (line: string) => void; signal?: AbortSignal },
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let output = '';
    // npm, npx, yarn, and pnpm are .cmd shims on Windows; Node refuses to
    // spawn those without a shell. Everything else runs shell-free so paths
    // with spaces survive.
    const needsShell = process.platform === 'win32' && /^(npm|npx|yarn|pnpm)$/i.test(command);
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      windowsHide: true,
      signal: options.signal,
      shell: needsShell,
    });
    const forward = (chunk: Buffer, isErr: boolean): void => {
      const text = chunk.toString('utf8');
      output += text;
      if (isErr) {
        stderr += text;
      } else {
        stdout += text;
      }
      if (options.log) {
        for (const line of text.split(/\r?\n/)) {
          if (line.length > 0) {
            options.log(line);
          }
        }
      }
    };
    child.stdout.on('data', (chunk: Buffer) => forward(chunk, false));
    child.stderr.on('data', (chunk: Buffer) => forward(chunk, true));
    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        reject(new Error(`Could not start '${command}'. Is it installed and on PATH?`));
      } else {
        reject(err);
      }
    });
    child.on('close', (code) => resolve({ exitCode: code, stdout, stderr, output }));
  });
}
