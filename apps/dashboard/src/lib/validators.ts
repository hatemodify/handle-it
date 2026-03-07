import { z } from "zod";

export const createJobSchema = z
  .object({
    type: z.enum(["code", "doc"]),
    engine: z.enum(["codex", "claude_code"]),
    workspacePath: z.string().nullable(),
    prompt: z.string().min(1),
    inputs: z.record(z.any()).optional()
  })
  .superRefine((value, ctx) => {
    if (value.type === "doc" && value.workspacePath !== null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "doc job must have null workspacePath" });
    }
    if (value.type === "code" && (!value.workspacePath || value.workspacePath.trim().length === 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "code job requires workspacePath" });
    }
  });
