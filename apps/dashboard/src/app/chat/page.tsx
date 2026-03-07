import Link from "next/link";
import { ChatPanel } from "@/app/components/chat-panel";
import { requireSessionUser } from "@/lib/auth";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const user = await requireSessionUser();
  const sessions = await pool.query(
    `SELECT id, title, status, created_at, updated_at
     FROM chat_sessions
     WHERE user_id = $1
     ORDER BY updated_at DESC
     LIMIT 100`,
    [user.id]
  );

  return (
    <main className="page stack">
      <div className="card hero">
        <div className="stack" style={{ gap: 6 }}>
          <h1>챗 작업실</h1>
          <p>AI 초안 확인 후 승인하면 실제 작업이 큐에 등록됩니다.</p>
        </div>
        <div className="hero-links">
          <Link className="button-link secondary" href="/jobs">운영 대시보드</Link>
        </div>
      </div>
      <ChatPanel initialSessions={sessions.rows} />
    </main>
  );
}
