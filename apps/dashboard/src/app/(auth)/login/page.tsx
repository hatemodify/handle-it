import { env } from "@/lib/env";

export default function LoginPage() {
  return (
    <main>
      <div className="card">
        <h1>AI Remote Orchestrator</h1>
        {env.localDevAuthBypass ? (
          <>
            <p>로컬 개발 모드입니다. 인증 없이 작업 페이지로 이동합니다.</p>
            <a href="/jobs">/jobs 이동</a>
          </>
        ) : (
          <>
            <p>Google OAuth로 로그인 후 작업을 생성할 수 있습니다.</p>
            <a href="/api/auth/google/start">Google 로그인</a>
          </>
        )}
      </div>
    </main>
  );
}
