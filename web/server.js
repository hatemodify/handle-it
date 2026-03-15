// ═══════════════════════════════════════════════════
//  handle-it Web UI — Node.js HTTP Server
//  API + SSE + Static Files (zero dependencies)
// ═══════════════════════════════════════════════════
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, watch, readFile } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';

const __dir = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dir, '..');
const SCRIPTS_DIR = join(PKG_ROOT, 'scripts');
const PROMPTS_DIR = join(PKG_ROOT, 'prompts');

// ── Config ──
const PORT = parseInt(process.env.HANDLE_IT_UI_PORT || '3847', 10);
const TEAMS_ROOT = process.env.HANDLE_IT_TEAMS_ROOT
  || process.env.AUTODEV_TEAMS_ROOT
  || join(homedir(), '.handle-it', 'teams');

// ── MIME types ──
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg':  'image/svg+xml',
};

// ── Helpers ──
function jsonResponse(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
  });
  res.end(JSON.stringify(data));
}

function errorResponse(res, message, status = 400) {
  jsonResponse(res, { error: message }, status);
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function getTeamsList() {
  if (!existsSync(TEAMS_ROOT)) return [];
  return readdirSync(TEAMS_ROOT)
    .filter(d => existsSync(join(TEAMS_ROOT, d, 'config.json')))
    .map(d => {
      const config = readJsonSafe(join(TEAMS_ROOT, d, 'config.json'));
      const queue = readJsonSafe(join(TEAMS_ROOT, d, 'tasks', 'queue.json'));
      const tasks = queue?.tasks || [];
      const total = tasks.length;
      const completed = tasks.filter(t => t.status === 'completed').length;
      const failed = tasks.filter(t => t.status === 'failed').length;
      const inProgress = tasks.filter(t => t.status === 'in_progress').length;
      return {
        id: d,
        team_name: config?.team_name || d,
        status: config?.status || 'unknown',
        created_at: config?.created_at || null,
        progress: { total, completed, failed, in_progress: inProgress, pending: total - completed - failed - inProgress },
        mtime: statSync(join(TEAMS_ROOT, d)).mtimeMs,
      };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

function getTeamDetail(teamId) {
  const teamDir = join(TEAMS_ROOT, teamId);
  if (!existsSync(join(teamDir, 'config.json'))) return null;

  const config = readJsonSafe(join(teamDir, 'config.json'));
  const queue = readJsonSafe(join(teamDir, 'tasks', 'queue.json'));
  const projectDir = existsSync(join(teamDir, 'project_dir'))
    ? readFileSync(join(teamDir, 'project_dir'), 'utf-8').trim()
    : null;

  // Agent liveness check
  const agents = (config?.agents || []).map(a => {
    let alive = false;
    try { process.kill(a.pid, 0); alive = true; } catch {}

    // Heartbeat check
    let lastHeartbeat = null;
    const hbFile = join(teamDir, 'agents', `${a.name}.heartbeat`);
    if (existsSync(hbFile)) {
      try { lastHeartbeat = statSync(hbFile).mtimeMs; } catch {}
    }

    return { ...a, alive, last_heartbeat: lastHeartbeat };
  });

  // Lead agent (main autodev.sh process) — detect from PID or status
  const leadPidFile = join(teamDir, 'agents', 'lead.pid');
  let leadAgent = null;
  if (config?.status === 'active') {
    let leadAlive = false;
    if (existsSync(leadPidFile)) {
      try {
        const leadPid = parseInt(readFileSync(leadPidFile, 'utf-8').trim(), 10);
        process.kill(leadPid, 0);
        leadAlive = true;
      } catch {}
    } else {
      // If pipeline is active and child process is running, lead is alive
      leadAlive = true;
    }
    leadAgent = {
      name: 'lead',
      role: '리드 오케스트레이터 — 헬스체크, 진행률, 태스크 재할당',
      status: leadAlive ? 'active' : 'stopped',
      alive: leadAlive,
      pid: null,
    };
  }

  const allAgents = leadAgent ? [leadAgent, ...agents] : agents;

  return {
    id: teamId,
    team_name: config?.team_name || teamId,
    status: config?.status || 'unknown',
    created_at: config?.created_at || null,
    project_dir: projectDir,
    tasks: queue?.tasks || [],
    agents: allAgents,
  };
}

function getTeamReview(teamId) {
  const teamDir = join(TEAMS_ROOT, teamId);
  const queue = readJsonSafe(join(teamDir, 'tasks', 'queue.json'));
  const tasks = queue?.tasks || [];

  // Find the __review__ task
  const reviewTask = tasks.find(t => t.assigned_to === '__review__');
  if (!reviewTask) return { has_review: false };

  // Check if review is pending (all dependencies completed but review itself not done)
  const depsDone = (reviewTask.depends_on || []).every(depId => {
    const dep = tasks.find(t => t.id === depId);
    return dep?.status === 'completed';
  });
  const isPending = reviewTask.status === 'pending' && depsDone;
  const isCompleted = reviewTask.status === 'completed';

  // Read planning documents from project dir
  const projectDirFile = join(teamDir, 'project_dir');
  const projectDir = existsSync(projectDirFile)
    ? readFileSync(projectDirFile, 'utf-8').trim()
    : null;

  const documents = {};
  if (projectDir) {
    // PRD
    for (const name of ['prd.md', 'PRD.md']) {
      const p = join(projectDir, name);
      if (existsSync(p)) { documents.prd = readFileSync(p, 'utf-8'); break; }
    }
    // Stack
    for (const name of ['stack.json', 'tech_stack.json']) {
      const p = join(projectDir, name);
      if (existsSync(p)) { documents.stack = readFileSync(p, 'utf-8'); break; }
    }
    // Tasks
    for (const name of ['tasks.json', 'dev_tasks.json']) {
      const p = join(projectDir, name);
      if (existsSync(p)) { documents.tasks = readFileSync(p, 'utf-8'); break; }
    }
    // Design spec
    for (const name of ['design_spec.json', 'design.json']) {
      const p = join(projectDir, name);
      if (existsSync(p)) { documents.design = readFileSync(p, 'utf-8'); break; }
    }
    // Modify mode docs
    for (const name of ['analysis.json']) {
      const p = join(projectDir, name);
      if (existsSync(p)) { documents.analysis = readFileSync(p, 'utf-8'); break; }
    }
    for (const name of ['change_plan.md', 'CHANGE_PLAN.md']) {
      const p = join(projectDir, name);
      if (existsSync(p)) { documents.change_plan = readFileSync(p, 'utf-8'); break; }
    }
  }

  return {
    has_review: true,
    review_task: reviewTask,
    is_pending: isPending,
    is_completed: isCompleted,
    documents,
  };
}

function approveReview(teamId) {
  const teamDir = join(TEAMS_ROOT, teamId);
  const queueFile = join(teamDir, 'tasks', 'queue.json');
  const queue = readJsonSafe(queueFile);
  if (!queue?.tasks) return { success: false, error: 'Queue not found' };

  const reviewTask = queue.tasks.find(t => t.assigned_to === '__review__');
  if (!reviewTask) return { success: false, error: 'No review task found' };
  if (reviewTask.status === 'completed') return { success: false, error: 'Already approved' };

  // Mark review task as completed
  reviewTask.status = 'completed';
  reviewTask.completed_at = new Date().toISOString();
  reviewTask.result = 'User approved via Web UI';
  reviewTask.owner = 'user';

  try {
    writeFileSync(queueFile, JSON.stringify(queue, null, 2));
    return { success: true, task_id: reviewTask.id };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function rejectReview(teamId, feedback) {
  const teamDir = join(TEAMS_ROOT, teamId);
  const queueFile = join(teamDir, 'tasks', 'queue.json');
  const queue = readJsonSafe(queueFile);
  if (!queue?.tasks) return { success: false, error: 'Queue not found' };

  const reviewTask = queue.tasks.find(t => t.assigned_to === '__review__');
  if (!reviewTask) return { success: false, error: 'No review task found' };

  // Find planning tasks (dependencies of the review task) and reset them
  const planTaskIds = reviewTask.depends_on || [];
  const resetIds = [];

  for (const taskId of planTaskIds) {
    const task = queue.tasks.find(t => t.id === taskId);
    if (task && task.status === 'completed') {
      task.status = 'pending';
      task.owner = null;
      task.completed_at = null;
      task.result = null;
      // Append feedback to description
      if (feedback) {
        task.description += `\n\n[사용자 피드백] ${feedback}`;
      }
      resetIds.push(taskId);
    }
  }

  try {
    writeFileSync(queueFile, JSON.stringify(queue, null, 2));
    return { success: true, reset_tasks: resetIds };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function getTeamReports(teamId) {
  const reportsDir = join(TEAMS_ROOT, teamId, 'reports');
  if (!existsSync(reportsDir)) return [];
  try {
    return readdirSync(reportsDir)
      .filter(f => f.endsWith('.json'))
      .sort((a, b) => {
        const ta = statSync(join(reportsDir, a)).mtimeMs;
        const tb = statSync(join(reportsDir, b)).mtimeMs;
        return tb - ta;
      })
      .map(f => {
        const data = readJsonSafe(join(reportsDir, f));
        return data ? { file: f, ...data } : null;
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function getAgentLog(teamId, agent, offset = 0, limit = 200) {
  const logFile = join(TEAMS_ROOT, teamId, 'logs', `${agent}.log`);
  if (!existsSync(logFile)) return { lines: [], total: 0 };
  try {
    const content = readFileSync(logFile, 'utf-8');
    const allLines = content.split('\n');
    const total = allLines.length;
    const lines = allLines.slice(offset, offset + limit);
    return { lines, total, offset };
  } catch {
    return { lines: [], total: 0 };
  }
}

// ── Input validation ──
function isValidTeamId(id) {
  return /^[a-zA-Z0-9_-]+$/.test(id) && !id.includes('..');
}

function isValidAgentName(name) {
  return /^[a-zA-Z0-9_-]+$/.test(name);
}

function isValidTaskId(id) {
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

// ── SSE ──
function setupSSE(res, teamId) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(':\n\n'); // keepalive comment

  const teamDir = join(TEAMS_ROOT, teamId);
  const watchers = [];
  let debounceTimer = null;
  let lastQueueState = '';
  let lastAgentStates = '';
  const logOffsets = {};

  function sendEvent(event, data) {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {}
  }

  function checkQueueUpdates() {
    const queueFile = join(teamDir, 'tasks', 'queue.json');
    const queue = readJsonSafe(queueFile);
    if (!queue) return;
    const state = JSON.stringify(queue.tasks?.map(t => `${t.id}:${t.status}:${t.owner || ''}`));
    if (state !== lastQueueState) {
      lastQueueState = state;
      sendEvent('task-update', { tasks: queue.tasks });
    }
  }

  function checkAgentUpdates() {
    const config = readJsonSafe(join(teamDir, 'config.json'));
    if (!config?.agents) return;
    const agents = config.agents.map(a => {
      let alive = false;
      try { process.kill(a.pid, 0); alive = true; } catch {}
      return { ...a, alive };
    });
    const state = JSON.stringify(agents.map(a => `${a.name}:${a.alive}:${a.respawn_count || 0}`));
    if (state !== lastAgentStates) {
      lastAgentStates = state;
      sendEvent('agent-update', { agents });
    }
  }

  function checkLogUpdates() {
    const logsDir = join(teamDir, 'logs');
    if (!existsSync(logsDir)) return;
    try {
      const logFiles = readdirSync(logsDir).filter(f => f.endsWith('.log'));
      for (const logFile of logFiles) {
        const agent = logFile.replace('.log', '');
        const fullPath = join(logsDir, logFile);
        try {
          const content = readFileSync(fullPath, 'utf-8');
          const lines = content.split('\n');
          const prevOffset = logOffsets[agent] || 0;
          if (lines.length > prevOffset) {
            const newLines = lines.slice(prevOffset).filter(l => l.trim());
            if (newLines.length > 0) {
              sendEvent('log-line', { agent, lines: newLines, offset: lines.length });
            }
            logOffsets[agent] = lines.length;
          }
        } catch {}
      }
    } catch {}
  }

  function debouncedUpdate() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      checkQueueUpdates();
      checkAgentUpdates();
      checkLogUpdates();
    }, 200);
  }

  // Watch queue.json
  const queueFile = join(teamDir, 'tasks', 'queue.json');
  if (existsSync(queueFile)) {
    try {
      watchers.push(watch(queueFile, debouncedUpdate));
    } catch {}
  }

  // Watch config.json (agent changes)
  const configFile = join(teamDir, 'config.json');
  if (existsSync(configFile)) {
    try {
      watchers.push(watch(configFile, debouncedUpdate));
    } catch {}
  }

  // Watch logs directory
  const logsDir = join(teamDir, 'logs');
  if (existsSync(logsDir)) {
    try {
      watchers.push(watch(logsDir, { recursive: true }, debouncedUpdate));
    } catch {}
  }

  // Watch reports directory
  const reportsDir = join(teamDir, 'reports');
  if (existsSync(reportsDir)) {
    try {
      watchers.push(watch(reportsDir, (eventType, filename) => {
        if (filename?.endsWith('.json')) {
          const report = readJsonSafe(join(reportsDir, filename));
          if (report) sendEvent('report-new', { file: filename, ...report });
        }
      }));
    } catch {}
  }

  // Periodic heartbeat + full sync every 3s
  const heartbeatInterval = setInterval(() => {
    sendEvent('heartbeat', { ts: Date.now() });
    checkQueueUpdates();
    checkAgentUpdates();
  }, 3000);

  // Initial state push
  checkQueueUpdates();
  checkAgentUpdates();

  // Cleanup on close
  res.on('close', () => {
    clearInterval(heartbeatInterval);
    if (debounceTimer) clearTimeout(debounceTimer);
    watchers.forEach(w => { try { w.close(); } catch {} });
  });
}

// ── Pipeline actions ──
const runningPipelines = new Map();

function startPipeline(idea, projectDir, projectName) {
  return new Promise((resolve, reject) => {
    const configPath = join(process.cwd(), 'handle-it.config.json');
    let config = {};
    if (existsSync(configPath)) {
      try { config = JSON.parse(readFileSync(configPath, 'utf-8')); } catch {}
    }

    const env = {
      ...process.env,
      AUTODEV_ROOT: SCRIPTS_DIR,
      AUTODEV_PROMPTS: config.prompts_dir
        ? join(process.cwd(), config.prompts_dir)
        : PROMPTS_DIR,
      AUTODEV_TEAMS_ROOT: TEAMS_ROOT,
      AUTODEV_TIMEOUT: String(config.timeout || 7200),
      AUTODEV_HEALTH_INTERVAL: String(config.health_interval || 5),
      AUTODEV_TASK_TIMEOUT: String(config.task_timeout || 900),
      CLAUDE_BIN: config.claude_bin || process.env.CLAUDE_BIN || 'claude',
      AUTODEV_MODEL: config.model || process.env.AUTODEV_MODEL || '',
      AUTODEV_PROJECT_NAME: projectName || '',
      AUTODEV_AGENTS: (config.agents || []).join(','),
    };

    const args = [join(SCRIPTS_DIR, 'autodev.sh'), idea];
    if (projectDir) args.push(projectDir);

    const child = spawn('bash', args, { env, stdio: 'pipe', cwd: process.cwd() });

    // Capture the team name from early output
    let output = '';
    child.stdout.on('data', chunk => { output += chunk.toString(); });
    child.stderr.on('data', chunk => { output += chunk.toString(); });

    // Try to detect team ID from teams root (new directory appears)
    const before = existsSync(TEAMS_ROOT) ? new Set(readdirSync(TEAMS_ROOT)) : new Set();

    setTimeout(() => {
      if (!existsSync(TEAMS_ROOT)) {
        resolve({ pid: child.pid, team_id: null });
        return;
      }
      const after = readdirSync(TEAMS_ROOT);
      const newTeam = after.find(d => !before.has(d));
      const teamId = newTeam || null;
      if (teamId) {
        runningPipelines.set(teamId, child);
        child.on('exit', () => runningPipelines.delete(teamId));
      }
      resolve({ pid: child.pid, team_id: teamId });
    }, 3000);
  });
}

function stopPipeline(teamId) {
  const child = runningPipelines.get(teamId);
  if (child) {
    child.kill('SIGTERM');
    runningPipelines.delete(teamId);
  }

  // Kill agents from config
  const configFile = join(TEAMS_ROOT, teamId, 'config.json');
  const config = readJsonSafe(configFile);
  if (config?.agents) {
    config.agents.forEach(a => {
      try { process.kill(a.pid, 'SIGTERM'); } catch {}
    });
  }

  // Update config.json status to stopped
  if (config) {
    config.status = 'stopped';
    config.stopped_at = new Date().toISOString();
    if (config.agents) {
      config.agents.forEach(a => { a.status = 'stopped'; });
    }
    try {
      writeFileSync(configFile, JSON.stringify(config, null, 2));
    } catch {}
    return true;
  }
  return false;
}

function resumePipeline(teamId) {
  const configPath = join(process.cwd(), 'handle-it.config.json');
  let config = {};
  if (existsSync(configPath)) {
    try { config = JSON.parse(readFileSync(configPath, 'utf-8')); } catch {}
  }

  const env = {
    ...process.env,
    AUTODEV_ROOT: SCRIPTS_DIR,
    AUTODEV_PROMPTS: config.prompts_dir
      ? join(process.cwd(), config.prompts_dir)
      : PROMPTS_DIR,
    AUTODEV_TEAMS_ROOT: TEAMS_ROOT,
    AUTODEV_TIMEOUT: String(config.timeout || 7200),
    AUTODEV_HEALTH_INTERVAL: String(config.health_interval || 5),
    AUTODEV_TASK_TIMEOUT: String(config.task_timeout || 900),
    CLAUDE_BIN: config.claude_bin || process.env.CLAUDE_BIN || 'claude',
    AUTODEV_MODEL: config.model || process.env.AUTODEV_MODEL || '',
    HANDLE_IT_RESUME_TEAM: teamId,
  };

  const child = spawn('bash', [join(SCRIPTS_DIR, 'autodev.sh'), '__resume__'], {
    env, stdio: 'pipe', cwd: process.cwd(),
  });

  runningPipelines.set(teamId, child);
  child.on('exit', () => runningPipelines.delete(teamId));
  return { pid: child.pid };
}

function rerunTask(teamId, taskId) {
  const configPath = join(process.cwd(), 'handle-it.config.json');
  let config = {};
  if (existsSync(configPath)) {
    try { config = JSON.parse(readFileSync(configPath, 'utf-8')); } catch {}
  }

  const env = {
    ...process.env,
    AUTODEV_ROOT: SCRIPTS_DIR,
    AUTODEV_PROMPTS: config.prompts_dir
      ? join(process.cwd(), config.prompts_dir)
      : PROMPTS_DIR,
    AUTODEV_TEAMS_ROOT: TEAMS_ROOT,
    AUTODEV_TIMEOUT: String(config.timeout || 7200),
    AUTODEV_TASK_TIMEOUT: String(config.task_timeout || 900),
    CLAUDE_BIN: config.claude_bin || process.env.CLAUDE_BIN || 'claude',
    AUTODEV_MODEL: config.model || process.env.AUTODEV_MODEL || '',
    HANDLE_IT_RERUN_TEAM: teamId,
    HANDLE_IT_RERUN_TASK: taskId,
  };

  const child = spawn('bash', [join(SCRIPTS_DIR, 'autodev.sh'), '__rerun__'], {
    env, stdio: 'pipe', cwd: process.cwd(),
  });

  return { pid: child.pid };
}

// ── URL parsing ──
function parseUrl(url) {
  const [path, queryStr] = url.split('?');
  const query = {};
  if (queryStr) {
    queryStr.split('&').forEach(pair => {
      const [k, v] = pair.split('=');
      query[decodeURIComponent(k)] = decodeURIComponent(v || '');
    });
  }
  return { path, query };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) { req.destroy(); reject(new Error('Body too large')); }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { resolve({}); }
    });
  });
}

// ── Route matching ──
function matchRoute(path, pattern) {
  const pathParts = path.split('/').filter(Boolean);
  const patternParts = pattern.split('/').filter(Boolean);
  if (pathParts.length !== patternParts.length) return null;

  const params = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) {
      params[patternParts[i].slice(1)] = pathParts[i];
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

// ── HTTP Server ──
const server = createServer(async (req, res) => {
  const { path, query } = parseUrl(req.url);
  const method = req.method;

  try {
    // ── API Routes ──

    // GET /api/teams
    if (method === 'GET' && path === '/api/teams') {
      return jsonResponse(res, { teams: getTeamsList() });
    }

    // GET /api/teams/:id
    let params = matchRoute(path, '/api/teams/:id');
    if (method === 'GET' && params) {
      if (!isValidTeamId(params.id)) return errorResponse(res, 'Invalid team ID');
      const team = getTeamDetail(params.id);
      if (!team) return errorResponse(res, 'Team not found', 404);
      return jsonResponse(res, team);
    }

    // GET /api/teams/:id/logs/:agent
    params = matchRoute(path, '/api/teams/:id/logs/:agent');
    if (method === 'GET' && params) {
      if (!isValidTeamId(params.id)) return errorResponse(res, 'Invalid team ID');
      if (!isValidAgentName(params.agent)) return errorResponse(res, 'Invalid agent name');
      const offset = parseInt(query.offset || '0', 10);
      const limit = parseInt(query.limit || '200', 10);
      return jsonResponse(res, getAgentLog(params.id, params.agent, offset, limit));
    }

    // GET /api/teams/:id/reports
    params = matchRoute(path, '/api/teams/:id/reports');
    if (method === 'GET' && params) {
      if (!isValidTeamId(params.id)) return errorResponse(res, 'Invalid team ID');
      return jsonResponse(res, { reports: getTeamReports(params.id) });
    }

    // GET /api/teams/:id/review
    params = matchRoute(path, '/api/teams/:id/review');
    if (method === 'GET' && params) {
      if (!isValidTeamId(params.id)) return errorResponse(res, 'Invalid team ID');
      return jsonResponse(res, getTeamReview(params.id));
    }

    // POST /api/pipeline/:id/review
    params = matchRoute(path, '/api/pipeline/:id/review');
    if (method === 'POST' && params) {
      if (!isValidTeamId(params.id)) return errorResponse(res, 'Invalid team ID');
      const body = await readBody(req);
      if (body.action === 'approve') {
        return jsonResponse(res, approveReview(params.id));
      } else if (body.action === 'reject') {
        return jsonResponse(res, rejectReview(params.id, body.feedback || ''));
      }
      return errorResponse(res, 'action must be "approve" or "reject"');
    }

    // GET /api/events/:id (SSE)
    params = matchRoute(path, '/api/events/:id');
    if (method === 'GET' && params) {
      if (!isValidTeamId(params.id)) return errorResponse(res, 'Invalid team ID');
      if (!existsSync(join(TEAMS_ROOT, params.id, 'config.json'))) {
        return errorResponse(res, 'Team not found', 404);
      }
      return setupSSE(res, params.id);
    }

    // POST /api/pipeline/start
    if (method === 'POST' && path === '/api/pipeline/start') {
      const body = await readBody(req);
      if (!body.idea || typeof body.idea !== 'string' || body.idea.trim().length === 0) {
        return errorResponse(res, 'idea is required');
      }
      if (body.idea.length > 1000) {
        return errorResponse(res, 'idea too long (max 1000 chars)');
      }
      const result = await startPipeline(body.idea.trim(), body.project_dir || null, body.project_name || null);
      return jsonResponse(res, result);
    }

    // POST /api/pipeline/:id/stop
    params = matchRoute(path, '/api/pipeline/:id/stop');
    if (method === 'POST' && params) {
      if (!isValidTeamId(params.id)) return errorResponse(res, 'Invalid team ID');
      const stopped = stopPipeline(params.id);
      return jsonResponse(res, { stopped });
    }

    // POST /api/pipeline/:id/resume
    params = matchRoute(path, '/api/pipeline/:id/resume');
    if (method === 'POST' && params) {
      if (!isValidTeamId(params.id)) return errorResponse(res, 'Invalid team ID');
      const result = resumePipeline(params.id);
      return jsonResponse(res, result);
    }

    // POST /api/pipeline/:id/rerun/:taskId
    params = matchRoute(path, '/api/pipeline/:id/rerun/:taskId');
    if (method === 'POST' && params) {
      if (!isValidTeamId(params.id)) return errorResponse(res, 'Invalid team ID');
      if (!isValidTaskId(params.taskId)) return errorResponse(res, 'Invalid task ID');
      const result = rerunTask(params.id, params.taskId);
      return jsonResponse(res, result);
    }

    // ── Static files ──
    const staticFiles = {
      '/': 'index.html',
      '/index.html': 'index.html',
      '/app.js': 'app.js',
      '/style.css': 'style.css',
    };

    const file = staticFiles[path];
    if (file) {
      const filePath = join(__dir, file);
      if (existsSync(filePath)) {
        const ext = extname(file);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
        res.end(readFileSync(filePath));
        return;
      }
    }

    // 404 — SPA fallback for hash routes
    if (path === '/' || !path.startsWith('/api/')) {
      const indexPath = join(__dir, 'index.html');
      if (existsSync(indexPath)) {
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(readFileSync(indexPath));
        return;
      }
    }

    errorResponse(res, 'Not found', 404);
  } catch (err) {
    console.error('Server error:', err);
    errorResponse(res, 'Internal server error', 500);
  }
});

server.listen(PORT, () => {
  console.log(`\n  \x1b[1mhandle-it Web UI\x1b[0m`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  \x1b[2mCtrl+C to stop\x1b[0m\n`);
});
