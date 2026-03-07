import { spawn } from "node:child_process";

export type StreamFn = (line: string) => void;

export const runStreamingCommand = (
  command: string,
  cwd: string,
  onLine: StreamFn
): Promise<{ code: number; stdout: string }> => {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      env: process.env
    });

    let out = "";
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      out += text;
      text.split(/\r?\n/).filter(Boolean).forEach(onLine);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      text.split(/\r?\n/).filter(Boolean).forEach((line) => onLine(`[stderr] ${line}`));
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout: out });
    });
  });
};
