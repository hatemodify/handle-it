"use client";

import { useState } from "react";

type CreateJobPayload = {
  type: "code" | "doc";
  engine: "codex" | "claude_code";
  workspacePath: string | null;
  prompt: string;
  inputs?: Record<string, unknown>;
};

export function JobCreateForm() {
  const [type, setType] = useState<"code" | "doc">("doc");
  const [engine, setEngine] = useState<"codex" | "claude_code">("codex");
  const [workspacePath, setWorkspacePath] = useState("");
  const [prompt, setPrompt] = useState("");
  const [inputs, setInputs] = useState("{}");
  const [message, setMessage] = useState("");

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage("생성 중...");

    let parsedInputs: Record<string, unknown> = {};
    try {
      parsedInputs = JSON.parse(inputs);
    } catch {
      setMessage("inputs는 유효한 JSON이어야 합니다.");
      return;
    }

    const payload: CreateJobPayload = {
      type,
      engine,
      workspacePath: type === "code" ? workspacePath : null,
      prompt,
      inputs: parsedInputs
    };

    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });

    const body = await res.json();
    if (!res.ok) {
      setMessage(`실패: ${JSON.stringify(body)}`);
      return;
    }

    setMessage(`생성 완료: ${body.id}`);
    window.location.href = `/jobs/${body.id}`;
  };

  return (
    <form onSubmit={onSubmit} className="card">
      <h2>Job 생성</h2>

      <label>Type</label>
      <select value={type} onChange={(e) => setType(e.target.value as "code" | "doc")}>
        <option value="doc">doc</option>
        <option value="code">code</option>
      </select>

      <label>Engine</label>
      <select value={engine} onChange={(e) => setEngine(e.target.value as "codex" | "claude_code")}>
        <option value="codex">codex</option>
        <option value="claude_code">claude_code</option>
      </select>

      <label>Workspace Path (code job only)</label>
      <input
        value={workspacePath}
        onChange={(e) => setWorkspacePath(e.target.value)}
        placeholder="/Users/you/work/my-project"
      />

      <label>Prompt</label>
      <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={6} required />

      <label>Inputs (JSON)</label>
      <textarea value={inputs} onChange={(e) => setInputs(e.target.value)} rows={5} />

      <button type="submit">Create</button>
      <p>{message}</p>
    </form>
  );
}
