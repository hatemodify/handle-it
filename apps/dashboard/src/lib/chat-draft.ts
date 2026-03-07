import { z } from "zod";
import { createJobSchema } from "./validators";

export const chatMessageInputSchema = z.object({
  sessionId: z.string().uuid().optional(),
  message: z.string().min(1),
  type: z.enum(["code", "doc"]).optional(),
  engine: z.enum(["codex", "claude_code"]).optional(),
  workspacePath: z.string().nullable().optional(),
  inputs: z.record(z.any()).optional()
});

const inferType = (message: string): "code" | "doc" => {
  const lowered = message.toLowerCase();
  if (lowered.includes("문서") || lowered.includes("markdown") || lowered.includes("doc")) {
    return "doc";
  }
  return "code";
};

export const buildDraftJob = (input: z.infer<typeof chatMessageInputSchema>) => {
  const inferredType = input.type ?? inferType(input.message);
  const draft = {
    type: inferredType,
    engine: input.engine ?? "codex",
    workspacePath: inferredType === "code" ? (input.workspacePath ?? "") : null,
    prompt: input.message,
    inputs: input.inputs ?? {}
  };

  return createJobSchema.safeParse(draft);
};

export const buildAssistantReply = (draft: {
  type: "code" | "doc";
  engine: "codex" | "claude_code";
  workspacePath: string | null;
  prompt: string;
}) => {
  return [
    "요청을 실행 전 검토용 작업 초안으로 정리했습니다.",
    `- type: ${draft.type}`,
    `- engine: ${draft.engine}`,
    `- workspacePath: ${draft.workspacePath ?? "null"}`,
    `- prompt: ${draft.prompt}`,
    "승인 버튼을 누르면 queued 상태로 실행됩니다."
  ].join("\n");
};
