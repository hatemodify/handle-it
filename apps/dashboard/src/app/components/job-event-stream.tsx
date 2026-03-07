"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type EventRow = {
  id: number;
  job_id: string;
  type: "status" | "log" | "result";
  payload: Record<string, unknown>;
  created_at: string;
};

export function JobEventStream({ jobId, wsBaseUrl }: { jobId: string; wsBaseUrl: string }) {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [cursor, setCursor] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let mounted = true;

    const loadReplay = async () => {
      const res = await fetch(`/api/jobs/${jobId}/events?cursor=0`);
      const data = await res.json();
      if (!mounted || !res.ok) {
        return;
      }
      setEvents(data.events);
      setCursor(data.nextCursor ?? 0);
    };

    void loadReplay();

    return () => {
      mounted = false;
    };
  }, [jobId]);

  useEffect(() => {
    const connect = async () => {
      const res = await fetch("/api/ws-token");
      if (!res.ok) {
        return;
      }
      const { token } = await res.json();
      const ws = new WebSocket(`${wsBaseUrl}?token=${token}`);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        const parsed = JSON.parse(event.data) as {
          type: "JOB_EVENT";
          event: { id: number; jobId: string; type: "status" | "log" | "result"; payload: Record<string, unknown>; createdAt: string };
        };
        if (parsed.type !== "JOB_EVENT" || parsed.event.jobId !== jobId) {
          return;
        }

        setEvents((prev) => [
          ...prev,
          {
            id: parsed.event.id,
            job_id: parsed.event.jobId,
            type: parsed.event.type,
            payload: parsed.event.payload,
            created_at: parsed.event.createdAt
          }
        ]);
        setCursor(parsed.event.id);
      };
    };

    void connect();

    return () => {
      wsRef.current?.close();
    };
  }, [jobId, wsBaseUrl]);

  const text = useMemo(() => {
    return events.map((ev) => `[${ev.id}] ${ev.type} ${JSON.stringify(ev.payload)}`).join("\n");
  }, [events]);

  return (
    <div className="card">
      <h3>실시간 이벤트</h3>
      <p className="status-line">cursor: {cursor}</p>
      <pre>{text || "(no events yet)"}</pre>
    </div>
  );
}
