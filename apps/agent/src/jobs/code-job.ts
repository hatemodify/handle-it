import fs from "node:fs/promises";
import path from "node:path";
import { runCodex } from "../engines/codex.js";
import { runClaude } from "../engines/claude.js";
import { runStreamingCommand, type StreamFn } from "../engines/common.js";

type CodeJobInput = {
  id: string;
  engine: "codex" | "claude_code";
  workspacePath: string;
  prompt: string;
  inputs: Record<string, unknown>;
  codexCmd: string;
  claudeCmd: string;
  worktreeBase: string;
};

export const executeCodeJob = async (job: CodeJobInput, onLine: StreamFn) => {
  const baseBranch = (job.inputs.baseBranch as string) ?? "main";
  const runTests = Boolean(job.inputs.runTests ?? false);
  const testCommand = (job.inputs.testCommand as string) ?? "npm test";
  const createPr = Boolean(job.inputs.createPr ?? false);
  const prTitle = (job.inputs.prTitle as string) ?? `AI Job ${job.id}`;
  const prBody = (job.inputs.prBody as string) ?? `Automated changes from AI job ${job.id}`;

  const sourceWorkspace = path.resolve(job.workspacePath);
  const branch = `ai-job-${job.id.slice(0, 8)}`;
  const worktreeRoot = path.resolve(job.worktreeBase);
  const worktreeDir = path.join(worktreeRoot, branch);

  await fs.mkdir(worktreeRoot, { recursive: true });
  await runStreamingCommand(`rm -rf "${worktreeDir}"`, process.cwd(), onLine);

  const fetchRes = await runStreamingCommand(`git -C "${sourceWorkspace}" fetch origin`, process.cwd(), onLine);
  if (fetchRes.code !== 0) {
    onLine("origin fetch 실패. 로컬 브랜치 기준으로 계속 진행합니다.");
  }

  const fromOrigin = await runStreamingCommand(
    `git -C "${sourceWorkspace}" worktree add "${worktreeDir}" -b ${branch} origin/${baseBranch}`,
    process.cwd(),
    onLine
  );
  if (fromOrigin.code !== 0) {
    const fromLocal = await runStreamingCommand(
      `git -C "${sourceWorkspace}" worktree add "${worktreeDir}" -b ${branch} ${baseBranch}`,
      process.cwd(),
      onLine
    );
    if (fromLocal.code !== 0) {
      throw new Error("git worktree add failed");
    }
  }

  if (job.engine === "codex") {
    await runCodex(job.codexCmd, job.prompt, worktreeDir, onLine);
  } else {
    await runClaude(job.claudeCmd, job.prompt, worktreeDir, onLine);
  }

  if (runTests) {
    const testResult = await runStreamingCommand(testCommand, worktreeDir, onLine);
    if (testResult.code !== 0) {
      throw new Error("tests failed");
    }
  }

  await runStreamingCommand(`git -C "${worktreeDir}" add -A`, process.cwd(), onLine);
  const commitRes = await runStreamingCommand(
    `git -C "${worktreeDir}" commit -m "chore: ai job ${job.id}"`,
    process.cwd(),
    onLine
  );
  if (commitRes.code !== 0) {
    throw new Error("git commit failed (possibly no changes)");
  }

  const pushRes = await runStreamingCommand(`git -C "${worktreeDir}" push origin ${branch}`, process.cwd(), onLine);
  if (pushRes.code !== 0) {
    throw new Error("git push failed");
  }

  let prUrl: string | null = null;
  if (createPr) {
    const prRes = await runStreamingCommand(
      `gh pr create --title "${prTitle}" --body "${prBody}" --base ${baseBranch} --head ${branch}`,
      worktreeDir,
      onLine
    );
    if (prRes.code === 0) {
      prUrl = prRes.stdout.trim().split(/\r?\n/).find((line) => line.startsWith("http")) ?? null;
    }
  }

  return { branch, worktreeDir, workspacePath: sourceWorkspace, prUrl };
};
