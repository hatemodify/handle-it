import fs from "node:fs/promises";
import path from "node:path";
import { runCodex } from "../engines/codex.js";
import { runClaude } from "../engines/claude.js";
import type { StreamFn } from "../engines/common.js";

type DocJobInput = {
  id: string;
  engine: "codex" | "claude_code";
  prompt: string;
  codexCmd: string;
  claudeCmd: string;
  artifactDir: string;
};

export const executeDocJob = async (job: DocJobInput, onLine: StreamFn) => {
  await fs.mkdir(job.artifactDir, { recursive: true });

  const generated =
    job.engine === "codex"
      ? await runCodex(job.codexCmd, job.prompt, process.cwd(), onLine)
      : await runClaude(job.claudeCmd, job.prompt, process.cwd(), onLine);

  const artifactPath = path.join(job.artifactDir, `${job.id}.md`);
  await fs.writeFile(artifactPath, generated, "utf8");

  return {
    artifactPath,
    markdown: generated
  };
};
