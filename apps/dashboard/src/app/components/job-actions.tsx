"use client";

import { useState } from "react";

export function JobActions({ jobId }: { jobId: string }) {
  const [message, setMessage] = useState("");

  const cancel = async () => {
    const res = await fetch(`/api/jobs/${jobId}/cancel`, { method: "POST" });
    const body = await res.json();
    if (!res.ok) {
      setMessage(`cancel 실패: ${JSON.stringify(body)}`);
      return;
    }
    setMessage("cancel 요청 완료");
  };

  const retry = async () => {
    const res = await fetch(`/api/jobs/${jobId}/retry`, { method: "POST" });
    const body = await res.json();
    if (!res.ok) {
      setMessage(`retry 실패: ${JSON.stringify(body)}`);
      return;
    }
    window.location.href = `/jobs/${body.id}`;
  };

  return (
    <div className="card">
      <h3>작업 제어</h3>
      <div className="toolbar" style={{ marginTop: 10 }}>
        <button className="danger" onClick={cancel}>Cancel</button>
        <button className="secondary" onClick={retry}>Retry</button>
      </div>
      <p className="status-line">{message}</p>
    </div>
  );
}
