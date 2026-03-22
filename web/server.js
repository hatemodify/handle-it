// ═══════════════════════════════════════════════════
//  handle-it Web UI — Node.js HTTP Server
//  API + SSE + Static Files (zero dependencies)
// ═══════════════════════════════════════════════════
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, watch, readFile, rmSync, mkdirSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { homedir, networkInterfaces } from 'node:os';

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
  const isRejected = !isPending && !isCompleted && !!reviewTask.last_rejected_at;

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
    is_rejected: isRejected,
    rejection_feedback: reviewTask.rejection_feedback || null,
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

  // Mark review task as completed + clear rejection state
  reviewTask.status = 'completed';
  reviewTask.completed_at = new Date().toISOString();
  reviewTask.result = 'User approved via Web UI';
  reviewTask.owner = 'user';
  delete reviewTask.last_rejected_at;
  delete reviewTask.rejection_feedback;

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

  // Mark review task as rejected
  reviewTask.last_rejected_at = new Date().toISOString();
  reviewTask.rejection_feedback = feedback || '';

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

function getTeamSummary(teamId) {
  const teamDir = join(TEAMS_ROOT, teamId);
  const queueFile = join(teamDir, 'tasks', 'queue.json');
  if (!existsSync(queueFile)) return { error: 'No task queue found' };

  const queue = readJsonSafe(queueFile);
  if (!queue?.tasks) return { error: 'Invalid queue' };

  const tasks = queue.tasks;
  const completed = tasks.filter(t => t.status === 'completed');
  if (completed.length === 0) return { error: 'No tasks completed yet' };

  // Duration
  const config = readJsonSafe(join(teamDir, 'config.json'));
  const startTime = config?.created_at ? new Date(config.created_at).getTime() : 0;
  const lastCompleted = Math.max(...completed.map(t => t.completed_at ? new Date(t.completed_at).getTime() : 0));
  const durationMin = startTime && lastCompleted ? Math.round((lastCompleted - startTime) / 60000) : null;

  // Files created
  const projectDirFile = join(teamDir, 'project_dir');
  let filesCreated = [];
  if (existsSync(projectDirFile)) {
    const projectDir = readFileSync(projectDirFile, 'utf-8').trim();
    // Gather from reports
    const reportsDir = join(teamDir, 'reports');
    if (existsSync(reportsDir)) {
      try {
        readdirSync(reportsDir).filter(f => f.endsWith('.json')).forEach(f => {
          const report = readJsonSafe(join(reportsDir, f));
          if (report?.files_created) filesCreated.push(...report.files_created);
          if (report?.files_modified) filesCreated.push(...report.files_modified);
        });
      } catch {}
    }
    filesCreated = [...new Set(filesCreated)];
  }

  // PR URL — check git agent log
  let prUrl = null;
  const gitLog = join(teamDir, 'logs', 'git.log');
  if (existsSync(gitLog)) {
    try {
      const logContent = readFileSync(gitLog, 'utf-8');
      const prMatch = logContent.match(/https:\/\/github\.com\/[^\s]+\/pull\/\d+/);
      if (prMatch) prUrl = prMatch[0];
    } catch {}
  }

  // Agents used
  const agentsDir = join(teamDir, 'agents');
  let agentsUsed = 0;
  if (existsSync(agentsDir)) {
    try { agentsUsed = readdirSync(agentsDir).filter(f => f.endsWith('.sh')).length; } catch {}
  }

  return {
    tasks_total: tasks.length,
    tasks_completed: completed.length,
    tasks_failed: tasks.filter(t => t.status === 'failed').length,
    duration_min: durationMin,
    files_created: filesCreated,
    agents_used: agentsUsed,
    pr_url: prUrl,
  };
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

// ── Directory browser ──
function browseDirs(dirPath) {
  // Resolve ~ to home directory
  const resolved = dirPath.startsWith('~')
    ? join(homedir(), dirPath.slice(1))
    : dirPath;

  // Security: block path traversal
  if (resolved.includes('..')) return { error: 'Invalid path' };

  if (!existsSync(resolved)) return { error: 'Path not found', path: resolved };

  try {
    const stat = statSync(resolved);
    if (!stat.isDirectory()) return { error: 'Not a directory', path: resolved };

    const projectFiles = ['package.json', 'Cargo.toml', 'go.mod', 'pyproject.toml', 'pom.xml',
      'Gemfile', 'requirements.txt', 'composer.json', 'build.gradle', 'Makefile', '.git'];

    const entries = readdirSync(resolved, { withFileTypes: true })
      .filter(d => {
        // Only directories, skip hidden and node_modules
        if (!d.isDirectory()) return false;
        if (d.name.startsWith('.')) return false;
        if (d.name === 'node_modules') return false;
        return true;
      })
      .map(d => {
        const childPath = join(resolved, d.name);
        const childIsProject = projectFiles.some(f => existsSync(join(childPath, f)));
        return { name: d.name, path: childPath, is_project: childIsProject };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const isProject = projectFiles.some(f => existsSync(join(resolved, f)));

    return {
      path: resolved,
      parent: dirname(resolved),
      entries,
      is_project: isProject,
    };
  } catch {
    return { error: 'Cannot read directory', path: resolved };
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

// ── SSE client tracking (for chat streaming) ──
const sseClients = new Map(); // teamId → Set<sendEvent>

// ── Spec helpers ──
const SPEC_FILES = {
  prd: ['prd.md', 'PRD.md'],
  stack: ['stack.json', 'tech_stack.json'],
  tasks: ['tasks.json', 'dev_tasks.json'],
  design: ['design_spec.json', 'design.json'],
};

function isValidSpecKey(key) {
  return Object.hasOwn(SPEC_FILES, key);
}

function getTeamSpecs(teamId) {
  const teamDir = join(TEAMS_ROOT, teamId);
  const projectDirFile = join(teamDir, 'project_dir');
  const projectDir = existsSync(projectDirFile)
    ? readFileSync(projectDirFile, 'utf-8').trim()
    : null;
  if (!projectDir) return { specs: {} };

  const specs = {};
  for (const [key, names] of Object.entries(SPEC_FILES)) {
    for (const name of names) {
      const p = join(projectDir, name);
      if (existsSync(p)) { specs[key] = readFileSync(p, 'utf-8'); break; }
    }
  }
  return { specs, project_dir: projectDir };
}

function putTeamSpec(teamId, key, content) {
  if (!isValidSpecKey(key)) return { success: false, error: 'Invalid spec key' };
  if (typeof content !== 'string') return { success: false, error: 'Content must be string' };
  if (content.length > 512000) return { success: false, error: 'Content too large (max 500KB)' };

  const teamDir = join(TEAMS_ROOT, teamId);
  const projectDirFile = join(teamDir, 'project_dir');
  const projectDir = existsSync(projectDirFile)
    ? readFileSync(projectDirFile, 'utf-8').trim()
    : null;
  if (!projectDir) return { success: false, error: 'No project directory' };

  // Find existing file or use first candidate
  const names = SPEC_FILES[key];
  let target = null;
  for (const name of names) {
    const p = join(projectDir, name);
    if (existsSync(p)) { target = p; break; }
  }
  if (!target) target = join(projectDir, names[0]);

  try {
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(target, content);
    return { success: true, file: target };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function skipToDev(teamId) {
  const teamDir = join(TEAMS_ROOT, teamId);
  const queueFile = join(teamDir, 'tasks', 'queue.json');
  const queue = readJsonSafe(queueFile);
  if (!queue?.tasks) return { success: false, error: 'Queue not found' };

  const planningRoles = ['planner', 'architect', 'designer', '__review__'];
  const skipped = [];
  for (const task of queue.tasks) {
    if (planningRoles.includes(task.assigned_to) && task.status !== 'completed') {
      task.status = 'completed';
      task.completed_at = new Date().toISOString();
      task.result = 'Skipped via Web UI (Skip to Dev)';
      task.owner = 'user';
      skipped.push(task.id);
    }
  }

  try {
    writeFileSync(queueFile, JSON.stringify(queue, null, 2));
    return { success: true, skipped };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ── Chat helpers ──
function getChatFile(teamId) {
  return join(TEAMS_ROOT, teamId, 'chat.json');
}

function readChat(teamId) {
  const chatFile = getChatFile(teamId);
  const data = readJsonSafe(chatFile);
  return data?.messages || [];
}

function appendChatMessage(teamId, role, content) {
  const chatFile = getChatFile(teamId);
  let data = readJsonSafe(chatFile) || { messages: [] };
  const msg = {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    role,
    content,
    ts: new Date().toISOString(),
  };
  data.messages.push(msg);
  writeFileSync(chatFile, JSON.stringify(data, null, 2));
  return msg;
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

  // Register SSE client for chat streaming
  if (!sseClients.has(teamId)) sseClients.set(teamId, new Set());
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

  // Register for chat streaming
  sseClients.get(teamId).add(sendEvent);

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
    // Unregister SSE client
    const clients = sseClients.get(teamId);
    if (clients) {
      clients.delete(sendEvent);
      if (clients.size === 0) sseClients.delete(teamId);
    }
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

function deletePipeline(teamId) {
  // Stop first if running
  stopPipeline(teamId);

  const teamDir = join(TEAMS_ROOT, teamId);
  if (!existsSync(teamDir)) return false;

  try {
    rmSync(teamDir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
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

    // GET /api/browse?path=...
    if (method === 'GET' && path === '/api/browse') {
      const dirPath = query.path || homedir();
      return jsonResponse(res, browseDirs(dirPath));
    }

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

    // GET /api/teams/:id/summary
    params = matchRoute(path, '/api/teams/:id/summary');
    if (method === 'GET' && params) {
      if (!isValidTeamId(params.id)) return errorResponse(res, 'Invalid team ID');
      return jsonResponse(res, getTeamSummary(params.id));
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

    // ── Spec Editor APIs ──

    // GET /api/teams/:id/specs
    params = matchRoute(path, '/api/teams/:id/specs');
    if (method === 'GET' && params) {
      if (!isValidTeamId(params.id)) return errorResponse(res, 'Invalid team ID');
      return jsonResponse(res, getTeamSpecs(params.id));
    }

    // PUT /api/teams/:id/specs/:key
    params = matchRoute(path, '/api/teams/:id/specs/:key');
    if (method === 'PUT' && params) {
      if (!isValidTeamId(params.id)) return errorResponse(res, 'Invalid team ID');
      if (!isValidSpecKey(params.key)) return errorResponse(res, 'Invalid spec key');
      const body = await readBody(req);
      return jsonResponse(res, putTeamSpec(params.id, params.key, body.content));
    }

    // POST /api/teams/:id/specs/skip
    params = matchRoute(path, '/api/teams/:id/specs/skip');
    if (method === 'POST' && params) {
      if (!isValidTeamId(params.id)) return errorResponse(res, 'Invalid team ID');
      return jsonResponse(res, skipToDev(params.id));
    }

    // ── Chat APIs ──

    // GET /api/teams/:id/chat
    params = matchRoute(path, '/api/teams/:id/chat');
    if (method === 'GET' && params) {
      if (!isValidTeamId(params.id)) return errorResponse(res, 'Invalid team ID');
      return jsonResponse(res, { messages: readChat(params.id) });
    }

    // POST /api/teams/:id/chat
    params = matchRoute(path, '/api/teams/:id/chat');
    if (method === 'POST' && params) {
      if (!isValidTeamId(params.id)) return errorResponse(res, 'Invalid team ID');
      const body = await readBody(req);
      if (!body.message || typeof body.message !== 'string' || body.message.trim().length === 0) {
        return errorResponse(res, 'message is required');
      }
      if (body.message.length > 10000) {
        return errorResponse(res, 'message too long (max 10000 chars)');
      }

      const teamDir = join(TEAMS_ROOT, params.id);
      const teamId = params.id;

      // Save user message
      const userMsg = appendChatMessage(teamId, 'user', body.message.trim());

      // Build context prompt
      const projectDirFile = join(teamDir, 'project_dir');
      const projectDir = existsSync(projectDirFile)
        ? readFileSync(projectDirFile, 'utf-8').trim()
        : null;

      let context = '';
      if (projectDir) {
        // Read CLAUDE.md
        const claudeMd = join(projectDir, 'CLAUDE.md');
        if (existsSync(claudeMd)) {
          try { context += `## CLAUDE.md\n${readFileSync(claudeMd, 'utf-8').slice(0, 2000)}\n\n`; } catch {}
        }
        // Read prd.md summary
        for (const name of ['prd.md', 'PRD.md']) {
          const p = join(projectDir, name);
          if (existsSync(p)) {
            try { context += `## PRD (요약)\n${readFileSync(p, 'utf-8').slice(0, 1500)}\n\n`; } catch {}
            break;
          }
        }
        // Read stack.json
        for (const name of ['stack.json', 'tech_stack.json']) {
          const p = join(projectDir, name);
          if (existsSync(p)) {
            try { context += `## Tech Stack\n${readFileSync(p, 'utf-8').slice(0, 1000)}\n\n`; } catch {}
            break;
          }
        }
      }

      // Build conversation history (last 10 messages)
      const allMessages = readChat(teamId);
      const recentMessages = allMessages.slice(-10);
      let conversationHistory = recentMessages.map(m =>
        `${m.role === 'user' ? 'Human' : 'Assistant'}: ${m.content}`
      ).join('\n\n');

      const prompt = `You are an AI assistant for a software project. Answer questions about the project, help with code, and provide guidance.

## Project Context
${context || 'No project context available.'}
${projectDir ? `Project directory: ${projectDir}` : ''}

## Conversation
${conversationHistory}

Respond to the latest message. Be concise and helpful. Answer in the same language as the user's message.`;

      // Spawn claude --print
      const claudeBin = process.env.CLAUDE_BIN || 'claude';
      const child = spawn(claudeBin, [
        '--print',
        '--allowedTools', 'Read,Glob,Grep',
        '--dangerously-skip-permissions',
        '-p', prompt,
      ], { env: { ...process.env, CLAUDECODE: '' }, stdio: 'pipe' });

      let fullResponse = '';

      child.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        fullResponse += text;
        // Stream to all SSE clients for this team
        const clients = sseClients.get(teamId);
        if (clients) {
          clients.forEach(fn => fn('chat-chunk', { text, msg_id: userMsg.id }));
        }
      });

      child.stderr.on('data', (chunk) => {
        // Ignore stderr but capture for debugging
      });

      child.on('close', () => {
        // Save assistant response
        if (fullResponse.trim()) {
          appendChatMessage(teamId, 'assistant', fullResponse.trim());
        }
        // Notify done
        const clients = sseClients.get(teamId);
        if (clients) {
          clients.forEach(fn => fn('chat-done', { msg_id: userMsg.id, content: fullResponse.trim() }));
        }
      });

      // Return immediately with message ID
      return jsonResponse(res, { id: userMsg.id });
    }

    // POST /api/teams/:id/chat/clear
    params = matchRoute(path, '/api/teams/:id/chat/clear');
    if (method === 'POST' && params) {
      if (!isValidTeamId(params.id)) return errorResponse(res, 'Invalid team ID');
      const chatFile = getChatFile(params.id);
      try {
        writeFileSync(chatFile, JSON.stringify({ messages: [] }, null, 2));
        return jsonResponse(res, { success: true });
      } catch (err) {
        return jsonResponse(res, { success: false, error: err.message });
      }
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

    // POST /api/pipeline/:id/delete
    params = matchRoute(path, '/api/pipeline/:id/delete');
    if (method === 'POST' && params) {
      if (!isValidTeamId(params.id)) return errorResponse(res, 'Invalid team ID');
      const deleted = deletePipeline(params.id);
      return jsonResponse(res, { deleted });
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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  \x1b[1mhandle-it Web UI\x1b[0m`);
  console.log(`  http://localhost:${PORT}`);
  // Show network IP for mobile access
  const nets = networkInterfaces();
  for (const iface of Object.values(nets)) {
    for (const cfg of iface) {
      if (cfg.family === 'IPv4' && !cfg.internal) {
        console.log(`  http://${cfg.address}:${PORT}  \x1b[2m(network)\x1b[0m`);
      }
    }
  }
  console.log(`  \x1b[2mCtrl+C to stop\x1b[0m\n`);
});
