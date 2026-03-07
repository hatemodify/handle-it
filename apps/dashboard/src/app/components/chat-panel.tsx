"use client";

import { useEffect, useMemo, useState } from "react";

type Session = {
  id: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
};

type Message = {
  id: number;
  role: "user" | "assistant";
  content: string;
  proposed_job?: {
    type: "code" | "doc";
    engine: "codex" | "claude_code";
    workspacePath: string | null;
    prompt: string;
    inputs: Record<string, unknown>;
  } | null;
  approved_job_id?: string | null;
  created_at: string;
};

export function ChatPanel({ initialSessions }: { initialSessions: Session[] }) {
  const [sessions, setSessions] = useState<Session[]>(initialSessions);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(initialSessions[0]?.id ?? null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [type, setType] = useState<"code" | "doc">("code");
  const [engine, setEngine] = useState<"codex" | "claude_code">("codex");
  const [workspacePath, setWorkspacePath] = useState("");
  const [status, setStatus] = useState("");

  const currentTitle = useMemo(() => {
    return sessions.find((s) => s.id === currentSessionId)?.title ?? "새 대화";
  }, [sessions, currentSessionId]);

  const loadSessions = async () => {
    const fresh = await fetch("/api/chat/sessions");
    if (fresh.ok) {
      const data = await fresh.json();
      setSessions(data.sessions);
    }
  };

  const loadMessages = async (sessionId: string) => {
    const res = await fetch(`/api/chat/${sessionId}/messages`);
    if (!res.ok) {
      setStatus("메시지 조회 실패");
      return;
    }
    const body = await res.json();
    setMessages(body.messages);
  };

  useEffect(() => {
    if (currentSessionId) {
      void loadMessages(currentSessionId);
    }
  }, [currentSessionId]);

  const onSelectSession = async (sessionId: string) => {
    setCurrentSessionId(sessionId);
    await loadMessages(sessionId);
  };

  const onSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("전송 중...");

    const payload = {
      sessionId: currentSessionId ?? undefined,
      message: text,
      type,
      engine,
      workspacePath: type === "code" ? workspacePath : null,
      inputs: {}
    };

    const res = await fetch("/api/chat/message", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const body = await res.json();
    if (!res.ok) {
      setStatus(`실패: ${JSON.stringify(body)}`);
      return;
    }

    const sessionId = body.sessionId as string;
    setCurrentSessionId(sessionId);
    setMessages((prev) => [...prev, ...body.messages]);
    setText("");
    setStatus("AI 초안 생성 완료. 승인하면 실행됩니다.");
    await loadSessions();
  };

  const onApprove = async (messageId: number) => {
    if (!currentSessionId) {
      return;
    }
    setStatus("승인 처리 중...");
    const res = await fetch(`/api/chat/${currentSessionId}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messageId })
    });
    const body = await res.json();
    if (!res.ok) {
      setStatus(`승인 실패: ${JSON.stringify(body)}`);
      return;
    }
    setStatus(`승인 완료: job ${body.jobId}`);
    await loadMessages(currentSessionId);
  };

  return (
    <div className="split">
      <aside className="stack">
        <div className="card">
          <h2>세션</h2>
          <p style={{ marginTop: 4 }}>현재: {currentTitle}</p>
          <ul className="session-list" style={{ marginTop: 10 }}>
            {sessions.map((s) => (
              <li key={s.id} className="session-item">
                <button
                  type="button"
                  className={s.id === currentSessionId ? "" : "secondary"}
                  onClick={() => onSelectSession(s.id)}
                >
                  {s.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <section className="stack">
        <form className="card" onSubmit={onSend}>
          <h2>AI 요청</h2>
          <div className="form-grid" style={{ marginTop: 8 }}>
            <div>
              <label>Type</label>
              <select value={type} onChange={(e) => setType(e.target.value as "code" | "doc") }>
                <option value="code">code</option>
                <option value="doc">doc</option>
              </select>
            </div>
            <div>
              <label>Engine</label>
              <select value={engine} onChange={(e) => setEngine(e.target.value as "codex" | "claude_code") }>
                <option value="codex">codex</option>
                <option value="claude_code">claude_code</option>
              </select>
            </div>
            <div className="full">
              <label>Workspace Path (code만)</label>
              <input value={workspacePath} onChange={(e) => setWorkspacePath(e.target.value)} placeholder="/Users/you/workspace" />
            </div>
            <div className="full">
              <label>요청</label>
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} required />
            </div>
          </div>
          <div className="toolbar">
            <button type="submit">AI 응답 생성</button>
          </div>
          <p className="status-line">{status}</p>
        </form>

        <div className="card">
          <h2>대화</h2>
          <ul className="message-list" style={{ marginTop: 10 }}>
            {messages.map((m) => (
              <li key={m.id} className="message-item">
                <div className="meta-row">
                  <span className="tag">{m.role}</span>
                  <span className="tag">#{m.id}</span>
                  {m.approved_job_id ? <span className="tag ok">approved</span> : null}
                </div>
                <pre>{m.content}</pre>
                {m.role === "assistant" && m.proposed_job && !m.approved_job_id ? (
                  <div className="toolbar">
                    <button type="button" onClick={() => onApprove(m.id)}>승인 후 실행</button>
                  </div>
                ) : null}
                {m.approved_job_id ? <p className="status-line">승인된 job: {m.approved_job_id}</p> : null}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
