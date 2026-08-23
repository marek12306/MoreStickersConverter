import {spawn} from 'node:child_process';

const MAX_STDERR_BUFFER = 64 * 1024;
const MAX_STDOUT_BUFFER = 2 * 1024 * 1024;
const DEFAULT_PROCESS_TIMEOUT_MS = 2 * 60 * 1000;
const DEFAULT_KILL_GRACE_MS = 2_000;

export interface ProcessOutput {
  stdout: string;
  stderr: string;
}

export interface RunMediaProcessOptions {
  timeoutMs?: number;
  killGraceMs?: number;
  signal?: AbortSignal;
}

export async function runMediaProcess(
  command: string,
  args: readonly string[],
  context: string,
  options: RunMediaProcessOptions = {},
): Promise<ProcessOutput> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROCESS_TIMEOUT_MS;
  const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  if (options.signal?.aborted) {
    throw new Error(`${command} aborted before starting for ${context}`);
  }

  return await new Promise<ProcessOutput>((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let terminationReason: 'aborted' | 'timed out' | undefined;
    let processError: Error | undefined;

    let child;
    try {
      child = spawn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      reject(
        new Error(
          `Failed to spawn ${command} for ${context}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
      return;
    }

    let forceKillTimer: NodeJS.Timeout | undefined;
    const terminate = (reason: 'aborted' | 'timed out') => {
      if (terminationReason) return;
      terminationReason = reason;
      child.kill('SIGTERM');
      forceKillTimer = setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
      }, killGraceMs);
    };
    const abortHandler = () => terminate('aborted');
    options.signal?.addEventListener('abort', abortHandler, {once: true});
    const timeout = setTimeout(() => terminate('timed out'), timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      if (stdout.length > MAX_STDOUT_BUFFER) {
        stdout = stdout.slice(stdout.length - MAX_STDOUT_BUFFER);
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > MAX_STDERR_BUFFER) {
        stderr = stderr.slice(stderr.length - MAX_STDERR_BUFFER);
      }
    });
    child.on('error', err => {
      processError = new Error(
        `${command} process error for ${context}: ${err.message}`,
      );
    });
    child.on('close', code => {
      clearTimeout(timeout);
      clearTimeout(forceKillTimer);
      options.signal?.removeEventListener('abort', abortHandler);

      if (terminationReason) {
        reject(
          new Error(
            `${command} ${terminationReason} for ${context}. Error output: ${stderr.trim().slice(-2048)}`,
          ),
        );
        return;
      }
      if (processError) {
        reject(processError);
        return;
      }
      if (code === 0) {
        resolve({stdout, stderr});
        return;
      }
      reject(
        new Error(
          `${command} exited with code ${code} for ${context}. Error output: ${stderr.trim().slice(-2048)}`,
        ),
      );
    });
  });
}
