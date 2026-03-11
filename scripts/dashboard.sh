#!/bin/bash
# ═══════════════════════════════════════
#  dashboard.sh — 웹 대시보드 서버
#  사용법: dashboard.sh <team_dir> [port]
# ═══════════════════════════════════════
set -euo pipefail

TEAM_DIR="${1:?'사용법: dashboard.sh <team_dir> [port]'}"
PORT="${2:-3847}"

echo -e "\033[1;37m  handle-it Dashboard\033[0m"
echo -e "  http://localhost:$PORT"
echo -e "  \033[2mCtrl+C로 종료\033[0m"
echo ""

node -e "
const http = require('http');
const fs = require('fs');
const path = require('path');

const TEAM_DIR = '${TEAM_DIR}';
const PORT = ${PORT};

const HTML = \`<!DOCTYPE html>
<html lang=\"ko\">
<head>
<meta charset=\"UTF-8\">
<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">
<title>handle-it Dashboard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'SF Mono', 'Fira Code', monospace; background: #0d1117; color: #c9d1d9; padding: 24px; }
  h1 { color: #58a6ff; margin-bottom: 8px; font-size: 24px; }
  .subtitle { color: #484f58; margin-bottom: 24px; font-size: 14px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; }
  .card h2 { color: #58a6ff; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px; }
  .progress-bar { width: 100%; height: 24px; background: #21262d; border-radius: 12px; overflow: hidden; margin-bottom: 8px; }
  .progress-fill { height: 100%; background: linear-gradient(90deg, #238636, #2ea043); transition: width 0.5s; border-radius: 12px; }
  .progress-text { text-align: center; font-size: 18px; font-weight: bold; color: #f0f6fc; }
  .stats { display: flex; gap: 16px; justify-content: center; margin: 12px 0; }
  .stat { text-align: center; }
  .stat-value { font-size: 24px; font-weight: bold; }
  .stat-label { font-size: 11px; color: #484f58; }
  .stat-pending .stat-value { color: #d29922; }
  .stat-progress .stat-value { color: #58a6ff; }
  .stat-done .stat-value { color: #2ea043; }
  .stat-fail .stat-value { color: #f85149; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; color: #484f58; font-size: 11px; text-transform: uppercase; padding: 8px; border-bottom: 1px solid #21262d; }
  td { padding: 8px; border-bottom: 1px solid #161b22; font-size: 13px; }
  .status { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
  .status-completed { background: #2ea043; }
  .status-in_progress { background: #58a6ff; animation: pulse 1.5s infinite; }
  .status-pending { background: #484f58; }
  .status-failed { background: #f85149; }
  .agent-alive { color: #2ea043; }
  .agent-dead { color: #f85149; }
  .report { padding: 8px 0; border-bottom: 1px solid #21262d; font-size: 13px; }
  .report-agent { color: #d2a8ff; font-weight: bold; }
  .report-summary { color: #8b949e; }
  .fullwidth { grid-column: 1 / -1; }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }
</style>
</head>
<body>
  <h1>handle-it Dashboard</h1>
  <div class=\"subtitle\" id=\"team-info\">Loading...</div>

  <div class=\"grid\">
    <div class=\"card fullwidth\">
      <h2>Progress</h2>
      <div class=\"progress-bar\"><div class=\"progress-fill\" id=\"progress-fill\"></div></div>
      <div class=\"progress-text\" id=\"progress-text\">0%</div>
      <div class=\"stats\">
        <div class=\"stat stat-pending\"><div class=\"stat-value\" id=\"s-pending\">0</div><div class=\"stat-label\">대기</div></div>
        <div class=\"stat stat-progress\"><div class=\"stat-value\" id=\"s-progress\">0</div><div class=\"stat-label\">진행</div></div>
        <div class=\"stat stat-done\"><div class=\"stat-value\" id=\"s-done\">0</div><div class=\"stat-label\">완료</div></div>
        <div class=\"stat stat-fail\"><div class=\"stat-value\" id=\"s-fail\">0</div><div class=\"stat-label\">실패</div></div>
      </div>
    </div>

    <div class=\"card\">
      <h2>Tasks</h2>
      <table><thead><tr><th>상태</th><th>ID</th><th>태스크</th><th>에이전트</th></tr></thead>
      <tbody id=\"tasks-body\"></tbody></table>
    </div>

    <div class=\"card\">
      <h2>Agents</h2>
      <table><thead><tr><th>이름</th><th>역할</th><th>PID</th><th>상태</th></tr></thead>
      <tbody id=\"agents-body\"></tbody></table>
    </div>

    <div class=\"card fullwidth\">
      <h2>Recent Reports</h2>
      <div id=\"reports\">Loading...</div>
    </div>
  </div>

  <script>
    async function update() {
      try {
        const res = await fetch('/api/status');
        const data = await res.json();

        document.getElementById('team-info').textContent = data.team_name + ' · ' + new Date().toLocaleTimeString();

        const total = data.tasks.length;
        const completed = data.tasks.filter(t => t.status === 'completed').length;
        const failed = data.tasks.filter(t => t.status === 'failed').length;
        const inProgress = data.tasks.filter(t => t.status === 'in_progress').length;
        const pending = data.tasks.filter(t => t.status === 'pending').length;
        const pct = total > 0 ? Math.round(completed / total * 100) : 0;

        document.getElementById('progress-fill').style.width = pct + '%';
        document.getElementById('progress-text').textContent = pct + '% (' + completed + '/' + total + ')';
        document.getElementById('s-pending').textContent = pending;
        document.getElementById('s-progress').textContent = inProgress;
        document.getElementById('s-done').textContent = completed;
        document.getElementById('s-fail').textContent = failed;

        document.getElementById('tasks-body').innerHTML = data.tasks.map(t =>
          '<tr><td><span class=\"status status-' + t.status + '\"></span>' + t.status + '</td>' +
          '<td>' + t.id + '</td><td>' + t.subject + '</td><td>' + (t.owner || '-') + '</td></tr>'
        ).join('');

        document.getElementById('agents-body').innerHTML = data.agents.map(a =>
          '<tr><td>' + a.name + '</td><td>' + a.role + '</td><td>' + a.pid + '</td>' +
          '<td class=\"' + (a.alive ? 'agent-alive' : 'agent-dead') + '\">' +
          (a.alive ? 'alive' : 'dead') + (a.respawn_count > 0 ? ' (리스폰:' + a.respawn_count + ')' : '') + '</td></tr>'
        ).join('');

        document.getElementById('reports').innerHTML = data.reports.length > 0
          ? data.reports.map(r =>
              '<div class=\"report\"><span class=\"report-agent\">' + r.agent + '</span> ' +
              '<span class=\"report-summary\">' + r.summary + '</span></div>'
            ).join('')
          : '<div style=\"color:#484f58\">보고서 없음</div>';
      } catch (e) { console.error(e); }
    }
    update();
    setInterval(update, 2000);
  </script>
</body>
</html>\`;

function getStatus() {
  const queue = JSON.parse(fs.readFileSync(path.join(TEAM_DIR, 'tasks', 'queue.json'), 'utf-8'));
  const config = JSON.parse(fs.readFileSync(path.join(TEAM_DIR, 'config.json'), 'utf-8'));

  // Check agent liveness
  const agents = (config.agents || []).map(a => {
    let alive = false;
    try { process.kill(a.pid, 0); alive = true; } catch {}
    return { ...a, alive };
  });

  // Recent reports
  const reportsDir = path.join(TEAM_DIR, 'reports');
  let reports = [];
  try {
    reports = fs.readdirSync(reportsDir)
      .filter(f => f.endsWith('.json'))
      .sort((a, b) => fs.statSync(path.join(reportsDir, b)).mtimeMs - fs.statSync(path.join(reportsDir, a)).mtimeMs)
      .slice(0, 10)
      .map(f => JSON.parse(fs.readFileSync(path.join(reportsDir, f), 'utf-8')));
  } catch {}

  return {
    team_name: config.team_name,
    status: config.status,
    tasks: queue.tasks,
    agents,
    reports,
  };
}

const server = http.createServer((req, res) => {
  if (req.url === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getStatus()));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
  }
});

server.listen(PORT, () => {
  console.log('Dashboard running on http://localhost:' + PORT);
});
"
