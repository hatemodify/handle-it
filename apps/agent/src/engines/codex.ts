import { runStreamingCommand, type StreamFn } from "./common.js";

export const runCodex = async (cmd: string, prompt: string, cwd: string, onLine: StreamFn): Promise<string> => {
  const escapedPrompt = prompt.replaceAll('"', '\\"');
  const { code, stdout } = await runStreamingCommand(`${cmd} --prompt "${escapedPrompt}"`, cwd, onLine);
  if (code !== 0) {
    throw new Error(`codex command failed with exit code ${code}`);
  }
  return stdout;
};
