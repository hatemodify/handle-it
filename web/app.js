// ═══════════════════════════════════════════════════
//  handle-it Web UI — Frontend SPA
//  Router + Views + SSE Client + Dependency Graph
// ═══════════════════════════════════════════════════

const app = (() => {
  // ── State ──
  let currentTeamId = null;
  let currentView = 'overview'; // overview | specs | review | logs | reports | chat
  let teams = [];
  let teamDetail = null;
  let eventSource = null;
  let logData = {};        // { agent: [lines] }
  let activeLogAgent = null;
  let pollInterval = null;
  let reviewData = null;   // cached review documents

  // Spec editor state
  let specsData = null;    // { prd, stack, tasks, design }
  let activeSpecKey = 'prd';
  let specsOriginal = {};  // original content for revert
  let specsDirty = {};     // { key: bool }

  // Chat state
  let chatMessages = [];
  let chatLoading = false;
  let chatStreamBuffer = '';

  // ── API ──
  async function api(path, options = {}) {
    const res = await fetch(`/api${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    return res.json();
  }

  // ── Router ──
  function navigate(hash) {
    window.location.hash = hash;
  }

  function handleRoute() {
    const hash = window.location.hash || '#/';
    const parts = hash.slice(2).split('/'); // remove '#/'

    if (parts[0] === 'team' && parts[1]) {
      const teamId = parts[1];
      const subView = parts[2] || 'overview';
      selectTeam(teamId, subView);
    } else {
      currentTeamId = null;
      teamDetail = null;
      currentView = 'overview';
      if (eventSource) { eventSource.close(); eventSource = null; }
      setConnectionStatus(null); // idle
      renderHome();
    }
  }

  window.addEventListener('hashchange', handleRoute);

  // ── Data Loading ──
  async function loadTeams() {
    const data = await api('/teams');
    teams = data.teams || [];
    renderSidebar();
    return teams;
  }

  async function loadTeamDetail(teamId) {
    const data = await api(`/teams/${teamId}`);
    if (data.error) return null;
    teamDetail = data;
    return data;
  }

  async function selectTeam(teamId, subView = 'overview') {
    currentTeamId = teamId;
    currentView = subView;

    // Highlight sidebar
    renderSidebar();

    // Load detail
    await loadTeamDetail(teamId);
    if (!teamDetail) {
      renderMain('<div class="empty-state"><div class="empty-state-text">Team not found</div></div>');
      return;
    }

    // Initialize log data
    if (!logData[teamId]) logData[teamId] = {};

    // Connect SSE
    connectSSE(teamId);

    // Render
    renderTeamView();
  }

  // ── SSE ──
  function connectSSE(teamId) {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }

    eventSource = new EventSource(`/api/events/${teamId}`);

    eventSource.addEventListener('task-update', (e) => {
      const data = JSON.parse(e.data);
      if (teamDetail) {
        const prevReviewPending = hasReviewPending();
        teamDetail.tasks = data.tasks;
        const nowReviewPending = hasReviewPending();

        // Auto-navigate to review when it becomes available
        if (!prevReviewPending && nowReviewPending && currentView === 'overview') {
          switchView('review');
          return;
        }

        if (currentView === 'overview' || currentView === 'review') renderTeamView();
        updateSidebarProgress(teamId, data.tasks);
      }
    });

    eventSource.addEventListener('agent-update', (e) => {
      const data = JSON.parse(e.data);
      if (teamDetail) {
        teamDetail.agents = data.agents;
        if (currentView === 'overview') renderAgentCards();
      }
    });

    eventSource.addEventListener('log-line', (e) => {
      const data = JSON.parse(e.data);
      if (!logData[teamId]) logData[teamId] = {};
      if (!logData[teamId][data.agent]) logData[teamId][data.agent] = [];
      logData[teamId][data.agent].push(...data.lines);
      // Keep max 5000 lines per agent
      if (logData[teamId][data.agent].length > 5000) {
        logData[teamId][data.agent] = logData[teamId][data.agent].slice(-5000);
      }
      if (currentView === 'logs' && activeLogAgent === data.agent) {
        appendLogLines(data.lines);
      }
    });

    eventSource.addEventListener('report-new', (e) => {
      if (currentView === 'reports') {
        renderReportsView();
      }
    });

    eventSource.addEventListener('chat-chunk', (e) => {
      const data = JSON.parse(e.data);
      chatStreamBuffer += data.text;
      if (currentView === 'chat') updateChatStream();
    });

    eventSource.addEventListener('chat-done', (e) => {
      const data = JSON.parse(e.data);
      if (data.content) {
        chatMessages.push({ id: `msg_${Date.now()}`, role: 'assistant', content: data.content, ts: new Date().toISOString() });
      }
      chatStreamBuffer = '';
      chatLoading = false;
      if (currentView === 'chat') renderChatMessages();
    });

    eventSource.addEventListener('heartbeat', () => {
      setConnectionStatus(true);
    });

    eventSource.onopen = () => setConnectionStatus(true);
    eventSource.onerror = () => setConnectionStatus(false);
  }

  function setConnectionStatus(connected) {
    const dot = document.getElementById('connection-dot');
    const text = document.getElementById('connection-text');
    if (!dot || !text) return;
    if (connected === null) {
      dot.className = 'connection-dot idle';
      text.textContent = '';
    } else if (connected) {
      dot.className = 'connection-dot';
      text.textContent = 'Live';
    } else {
      dot.className = 'connection-dot disconnected';
      text.textContent = 'Disconnected';
    }
  }

  // ── Rendering Helpers ──
  function $(id) { return document.getElementById(id); }

  function renderMain(html) {
    const main = $('main-content');
    if (main) main.innerHTML = html;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Toast Notifications ──
  function showToast(message, type = 'info') {
    let container = $('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    // Auto-remove
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateX(100%)'; }, 3000);
    setTimeout(() => toast.remove(), 3500);
  }

  // ── Modal overlay click-to-close ──
  document.addEventListener('click', (e) => {
    if (e.target.id === 'modal-new-pipeline') hideNewPipelineModal();
    if (e.target.id === 'modal-import') hideImportModal();
  });

  // ── Sidebar ──
  function renderSidebar() {
    const list = $('team-list');
    if (!list) return;

    if (teams.length === 0) {
      list.innerHTML = '<div class="empty-state" style="padding: 16px;"><div class="empty-state-text" style="font-size: 12px;">No teams yet</div></div>';
      return;
    }

    list.innerHTML = teams.map(t => {
      const pct = t.progress.total > 0 ? Math.round(t.progress.completed / t.progress.total * 100) : 0;
      const active = t.id === currentTeamId ? ' active' : '';
      const statusIcon = t.status === 'active' ? '&#9679; ' : '';
      return `
        <a class="team-item${active}" href="#/team/${t.id}" data-team="${t.id}">
          <div class="team-item-name">${statusIcon}${escapeHtml(t.team_name)}</div>
          <div class="team-item-meta">${t.progress.completed}/${t.progress.total} tasks &middot; ${t.status}</div>
          <div class="team-item-progress"><div class="team-item-progress-fill" style="width: ${pct}%"></div></div>
        </a>
      `;
    }).join('');
  }

  function updateSidebarProgress(teamId, tasks) {
    const total = tasks.length;
    const completed = tasks.filter(t => t.status === 'completed').length;
    const pct = total > 0 ? Math.round(completed / total * 100) : 0;

    // Update sidebar item
    const item = document.querySelector(`.team-item[data-team="${teamId}"]`);
    if (item) {
      const meta = item.querySelector('.team-item-meta');
      const fill = item.querySelector('.team-item-progress-fill');
      if (meta) meta.innerHTML = `${completed}/${total} tasks`;
      if (fill) fill.style.width = `${pct}%`;
    }
  }

  // ── Home View ──
  function renderHome() {
    if (teams.length === 0) {
      renderMain(`
        <div class="empty-state">
          <div class="empty-state-icon">&#128640;</div>
          <div class="empty-state-text">Get started</div>
          <div class="empty-state-desc">
            Describe your idea and handle-it will generate PRD, architecture, code, tests, and a PR &mdash; all autonomously.
          </div>
          <div style="display: flex; gap: 10px; justify-content: center;">
            <button class="btn" onclick="app.showImportModal()">Import Project</button>
            <button class="btn btn-primary btn-lg" onclick="app.showNewPipelineModal()">+ New Pipeline</button>
          </div>
        </div>
      `);
    } else {
      const active = teams.filter(t => t.status === 'active');
      const inactive = teams.filter(t => t.status !== 'active');

      let html = `<div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
        <h2 style="color: var(--text-primary); font-size: 20px; font-weight: 800; letter-spacing: -0.3px;">Dashboard</h2>
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-sm" onclick="app.showImportModal()">Import</button>
          <button class="btn btn-primary btn-sm" onclick="app.showNewPipelineModal()">+ New</button>
        </div>
      </div>`;

      if (active.length > 0) {
        html += `<div class="section-label">Active</div>`;
        html += `<div class="grid-2">${active.map(renderTeamCard).join('')}</div>`;
      }

      if (inactive.length > 0) {
        html += `<div class="section-label" style="margin-top: 28px;">History</div>`;
        html += `<div class="grid-2">${inactive.map(renderTeamCard).join('')}</div>`;
      }

      renderMain(html);
    }
  }

  function renderTeamCard(t) {
    const pct = t.progress.total > 0 ? Math.round(t.progress.completed / t.progress.total * 100) : 0;
    const isActive = t.status === 'active';
    const timeAgo = formatTimeAgo(t.mtime);

    return `
      <div class="card team-card ${isActive ? 'team-card-active' : ''}" onclick="location.hash='#/team/${t.id}'">
        <div class="card-body">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
            <div class="team-card-name">${escapeHtml(t.team_name)}</div>
            <span class="pipeline-status ${t.status}">${t.status}</span>
          </div>
          <div class="progress-bar" style="height: 6px; border-radius: 3px;">
            <div class="progress-fill" style="width: ${pct}%; border-radius: 3px;"></div>
          </div>
          <div class="team-card-meta">
            <span>${t.progress.completed}/${t.progress.total} tasks</span>
            ${t.progress.failed > 0 ? `<span style="color: var(--accent-red);">${t.progress.failed} failed</span>` : ''}
            ${t.progress.in_progress > 0 ? `<span style="color: var(--accent-blue);">${t.progress.in_progress} running</span>` : ''}
            <span style="margin-left: auto;">${timeAgo}</span>
          </div>
        </div>
      </div>
    `;
  }

  function formatTimeAgo(ms) {
    const diff = Date.now() - ms;
    const s = Math.floor(diff / 1000);
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
  }

  // ── Team View ──
  function hasReviewPending() {
    const tasks = teamDetail?.tasks || [];
    const reviewTask = tasks.find(t => t.assigned_to === '__review__');
    if (!reviewTask || reviewTask.status !== 'pending') return false;
    const depsDone = (reviewTask.depends_on || []).every(depId => {
      const dep = tasks.find(t => t.id === depId);
      return dep?.status === 'completed';
    });
    return depsDone;
  }

  function renderTeamView() {
    if (!teamDetail) return;

    const reviewPending = hasReviewPending();
    const reviewBadge = reviewPending ? '<span class="review-badge">Review Required</span>' : '';

    const tabs = `
      <div class="nav-tabs">
        <button class="nav-tab ${currentView === 'overview' ? 'active' : ''}" onclick="app.switchView('overview')">Overview</button>
        <button class="nav-tab ${currentView === 'specs' ? 'active' : ''}" onclick="app.switchView('specs')">Specs</button>
        <button class="nav-tab ${currentView === 'review' ? 'active' : ''}" onclick="app.switchView('review')">
          Review ${reviewBadge}
        </button>
        <button class="nav-tab ${currentView === 'logs' ? 'active' : ''}" onclick="app.switchView('logs')">Logs</button>
        <button class="nav-tab ${currentView === 'reports' ? 'active' : ''}" onclick="app.switchView('reports')">Reports</button>
        <button class="nav-tab ${currentView === 'chat' ? 'active' : ''}" onclick="app.switchView('chat')">Chat</button>
      </div>
    `;

    const statusLabel = teamDetail.status === 'active'
      ? '<span class="pipeline-status active">Running</span>'
      : teamDetail.status === 'completed'
        ? '<span class="pipeline-status completed">Completed</span>'
        : '<span class="pipeline-status stopped">Stopped</span>';

    const actions = `
      <div class="team-header">
        <div class="team-header-left">
          <h2 class="team-title">${escapeHtml(teamDetail.team_name)}</h2>
          ${statusLabel}
        </div>
        <div class="team-header-right">
          ${teamDetail.status === 'active'
            ? `<button class="btn btn-danger btn-sm" onclick="app.stopPipeline('${teamDetail.id}')">Stop Pipeline</button>`
            : `<button class="btn btn-sm" onclick="app.resumePipeline('${teamDetail.id}')">Resume</button>
               <button class="btn btn-danger btn-sm" onclick="app.deletePipeline('${teamDetail.id}')">Delete</button>`
          }
        </div>
      </div>
    `;

    let content = '';
    switch (currentView) {
      case 'overview':
        content = renderOverview();
        break;
      case 'specs':
        content = '<div id="specs-container"><div class="loading-spinner"></div></div>';
        break;
      case 'review':
        content = '<div id="review-container"><div class="loading-spinner"></div></div>';
        break;
      case 'logs':
        content = renderLogsView();
        break;
      case 'reports':
        content = renderReportsViewHTML();
        break;
      case 'chat':
        content = renderChatView();
        break;
    }

    // If review is pending and user is on overview, show a banner
    const reviewBanner = (reviewPending && currentView === 'overview')
      ? `<div class="review-banner" onclick="app.switchView('review')">
           <span class="review-banner-icon">&#9998;</span>
           <span>Planning phase complete. Review and approve to start development.</span>
           <button class="btn btn-primary btn-sm">Review Now</button>
         </div>`
      : '';

    renderMain(actions + tabs + reviewBanner + content);

    // Post-render hooks
    if (currentView === 'overview') {
      renderDependencyGraph();
    }
    if (currentView === 'specs') {
      loadAndRenderSpecs();
    }
    if (currentView === 'review') {
      loadAndRenderReview();
    }
    if (currentView === 'logs') {
      if (!activeLogAgent && teamDetail.agents.length > 0) {
        activeLogAgent = teamDetail.agents[0].name;
      }
      loadAndRenderLog();
    }
    if (currentView === 'reports') {
      renderReportsView();
    }
    if (currentView === 'chat') {
      loadChat();
    }
  }

  function switchView(view) {
    currentView = view;
    if (currentTeamId) {
      window.location.hash = `#/team/${currentTeamId}/${view === 'overview' ? '' : view}`;
    }
    renderTeamView();
  }

  // ── Overview ──
  function renderOverview() {
    const tasks = teamDetail.tasks || [];
    const total = tasks.length;
    const completed = tasks.filter(t => t.status === 'completed').length;
    const failed = tasks.filter(t => t.status === 'failed').length;
    const inProgress = tasks.filter(t => t.status === 'in_progress').length;
    const pending = total - completed - failed - inProgress;
    const pct = total > 0 ? Math.round(completed / total * 100) : 0;

    return `
      <div class="card grid-full">
        <div class="card-header"><span class="card-title">Progress</span></div>
        <div class="card-body">
          <div class="progress-bar"><div class="progress-fill" style="width: ${pct}%"></div></div>
          <div class="progress-text">${pct}% (${completed}/${total})</div>
          <div class="stats-row">
            <div class="stat stat-pending"><div class="stat-value">${pending}</div><div class="stat-label">Pending</div></div>
            <div class="stat stat-progress"><div class="stat-value">${inProgress}</div><div class="stat-label">Running</div></div>
            <div class="stat stat-done"><div class="stat-value">${completed}</div><div class="stat-label">Done</div></div>
            <div class="stat stat-fail"><div class="stat-value">${failed}</div><div class="stat-label">Failed</div></div>
          </div>
        </div>
      </div>

      <div class="grid-2">
        <div class="card">
          <div class="card-header"><span class="card-title">Tasks</span></div>
          <div class="card-body" style="padding: 0;">
            <table>
              <thead><tr><th>Status</th><th>ID</th><th>Task</th><th>Assigned</th><th>Owner</th><th></th></tr></thead>
              <tbody>
                ${tasks.map(t => {
                  const isReview = t.assigned_to === '__review__';
                  const reviewReady = isReview && t.status === 'pending' && (t.depends_on || []).every(depId => {
                    const dep = tasks.find(d => d.id === depId);
                    return dep?.status === 'completed';
                  });
                  return `
                  <tr class="${isReview ? 'review-task-row' : ''}">
                    <td class="status-${t.status}"><span class="status-dot"></span><span class="status-text">${t.status}</span></td>
                    <td style="font-family: var(--font-mono); font-size: 12px;">${escapeHtml(t.id)}</td>
                    <td>${escapeHtml(t.subject)}${isReview ? ' <span class="review-task-label">checkpoint</span>' : ''}</td>
                    <td style="color: var(--text-dim); font-size: 12px;">${isReview ? 'user' : escapeHtml(t.assigned_to || 'any')}</td>
                    <td style="color: var(--accent-purple);">${escapeHtml(t.owner || '-')}</td>
                    <td>${reviewReady
                      ? `<button class="btn btn-primary btn-sm" onclick="app.switchView('review')">Review</button>`
                      : (t.status === 'failed' || t.status === 'completed')
                        ? `<button class="btn btn-sm" onclick="app.rerunTask('${teamDetail.id}', '${t.id}')">Rerun</button>`
                        : ''
                    }</td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <div class="card-header"><span class="card-title">Agents</span></div>
          <div class="card-body" id="agents-container">
            ${renderAgentCardsHTML()}
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><span class="card-title">Dependency Graph</span></div>
        <div class="card-body">
          <div class="dep-graph" id="dep-graph"></div>
        </div>
      </div>

      ${renderPromptCard()}
    `;
  }

  function renderPromptCard() {
    if (!teamDetail?.project_dir) return '';
    const isRunning = teamDetail.status === 'active';
    const dirName = teamDetail.project_dir.split('/').pop() || teamDetail.project_dir;

    return `
      <div class="prompt-card">
        <div class="prompt-header">
          <span class="prompt-icon">&#9889;</span>
          <span class="prompt-title">Send a prompt</span>
        </div>
        <p class="prompt-desc">${isRunning
          ? 'Pipeline is running. Queue a new modification to start after completion.'
          : 'Describe what you want to change — a new pipeline will start on this project.'
        }</p>
        <div class="prompt-input-row">
          <textarea class="form-textarea prompt-textarea" id="prompt-input" rows="2"
            placeholder="Add dark mode toggle, refactor auth to JWT, add i18n support..."></textarea>
          <button class="btn btn-primary" id="btn-send-prompt" onclick="app.sendPrompt()">
            ${isRunning ? 'Queue' : 'Run'}
          </button>
        </div>
        <div class="prompt-project-dir">&#128193; ${escapeHtml(dirName)}</div>
      </div>
    `;
  }

  function renderAgentCards() {
    const container = $('agents-container');
    if (container) container.innerHTML = renderAgentCardsHTML();
  }

  function getAgentTasks(agentName) {
    const tasks = teamDetail?.tasks || [];
    const assigned = tasks.filter(t => t.assigned_to === agentName);
    const owned = tasks.filter(t => t.owner === agentName);
    const current = tasks.find(t => t.owner === agentName && t.status === 'in_progress');
    const completed = owned.filter(t => t.status === 'completed');
    const failed = owned.filter(t => t.status === 'failed');
    return { assigned, current, completed, failed };
  }

  function renderAgentCardsHTML() {
    const agents = teamDetail?.agents || [];
    if (agents.length === 0) return '<div style="color: var(--text-dim); font-size: 13px;">No agents</div>';

    return `<div class="agents-grid">${agents.map(a => {
      const { assigned, current, completed, failed } = getAgentTasks(a.name);
      const totalAssigned = assigned.length;
      const doneCount = completed.length;
      const failCount = failed.length;

      return `
      <div class="agent-card ${a.alive ? 'alive' : 'dead'}">
        <div class="agent-name">${escapeHtml(a.name)}</div>
        <div class="agent-role">${escapeHtml(a.role || '')}</div>
        <div class="agent-status ${a.alive ? 'agent-alive' : 'agent-dead'}">
          ${a.alive ? '&#9679; alive' : '&#9675; stopped'}
          ${(a.respawn_count || 0) > 0 ? ` (respawn: ${a.respawn_count})` : ''}
        </div>
        ${current ? `
          <div class="agent-current-task">
            <span class="agent-task-icon">&#9654;</span>
            <span>${escapeHtml(current.id)}: ${escapeHtml(current.subject)}</span>
          </div>
        ` : ''}
        ${totalAssigned > 0 ? `
          <div class="agent-task-summary">
            <span class="agent-task-count done">${doneCount}</span>/<span class="agent-task-count total">${totalAssigned}</span> tasks
            ${failCount > 0 ? `<span class="agent-task-count fail">${failCount} failed</span>` : ''}
          </div>
          <div class="agent-task-list">
            ${assigned.map(t => `<div class="agent-task-item status-${t.status}"><span class="status-dot"></span>${escapeHtml(t.id)}</div>`).join('')}
          </div>
        ` : ''}
      </div>`;
    }).join('')}</div>`;
  }

  // ── Dependency Graph (SVG) ──
  function renderDependencyGraph() {
    const container = $('dep-graph');
    if (!container || !teamDetail) return;

    const tasks = teamDetail.tasks || [];
    if (tasks.length === 0) {
      container.innerHTML = '<div style="color: var(--text-dim); text-align: center;">No tasks</div>';
      return;
    }

    // Topological sort into layers
    const taskMap = new Map();
    tasks.forEach(t => taskMap.set(t.id, t));

    const layers = [];
    const placed = new Set();

    function getLayer(task) {
      if (placed.has(task.id)) return;
      const deps = (task.depends_on || []).filter(d => taskMap.has(d));
      let maxDepLayer = -1;
      for (const depId of deps) {
        if (!placed.has(depId)) getLayer(taskMap.get(depId));
        const depLayer = layers.findIndex(l => l.some(t => t.id === depId));
        if (depLayer > maxDepLayer) maxDepLayer = depLayer;
      }
      const targetLayer = maxDepLayer + 1;
      while (layers.length <= targetLayer) layers.push([]);
      layers[targetLayer].push(task);
      placed.add(task.id);
    }

    tasks.forEach(t => getLayer(t));

    // SVG dimensions
    const nodeW = 140;
    const nodeH = 40;
    const layerGap = 80;
    const nodeGap = 16;

    const maxNodesInLayer = Math.max(...layers.map(l => l.length));
    const svgW = layers.length * (nodeW + layerGap) + layerGap;
    const svgH = maxNodesInLayer * (nodeH + nodeGap) + nodeGap + 20;

    // Compute node positions
    const positions = new Map();
    layers.forEach((layer, li) => {
      const x = layerGap + li * (nodeW + layerGap);
      const totalH = layer.length * nodeH + (layer.length - 1) * nodeGap;
      const startY = (svgH - totalH) / 2;
      layer.forEach((task, ti) => {
        const y = startY + ti * (nodeH + nodeGap);
        positions.set(task.id, { x, y, task });
      });
    });

    // Status colors
    const statusColors = {
      completed: '#2ea043',
      in_progress: '#58a6ff',
      pending: '#484f58',
      failed: '#f85149',
    };

    const statusBg = {
      completed: '#1a3a2a',
      in_progress: '#1a2a3a',
      pending: '#1a1d22',
      failed: '#3a1a1a',
    };

    // Draw edges
    let edges = '';
    tasks.forEach(task => {
      const to = positions.get(task.id);
      if (!to) return;
      (task.depends_on || []).forEach(depId => {
        const from = positions.get(depId);
        if (!from) return;
        const x1 = from.x + nodeW;
        const y1 = from.y + nodeH / 2;
        const x2 = to.x;
        const y2 = to.y + nodeH / 2;
        const mx = (x1 + x2) / 2;
        const color = statusColors[task.status] || '#484f58';
        edges += `<path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" fill="none" stroke="${color}" stroke-width="1.5" opacity="0.5"/>`;
      });
    });

    // Draw nodes
    let nodes = '';
    positions.forEach(({ x, y, task }) => {
      const color = statusColors[task.status] || '#484f58';
      const bg = statusBg[task.status] || '#1a1d22';
      const label = task.subject.length > 16 ? task.subject.slice(0, 15) + '...' : task.subject;
      nodes += `
        <g>
          <rect x="${x}" y="${y}" width="${nodeW}" height="${nodeH}" rx="6" fill="${bg}" stroke="${color}" stroke-width="1.5"/>
          <circle cx="${x + 12}" cy="${y + nodeH / 2}" r="4" fill="${color}"/>
          <text x="${x + 22}" y="${y + nodeH / 2 + 4}" fill="#c9d1d9" font-size="11" font-family="var(--font-sans)">${escapeHtml(label)}</text>
        </g>
      `;
    });

    container.innerHTML = `
      <svg viewBox="0 0 ${svgW} ${svgH}" xmlns="http://www.w3.org/2000/svg">
        ${edges}
        ${nodes}
      </svg>
    `;
  }

  // ── Logs View ──
  function renderLogsView() {
    const agents = teamDetail?.agents || [];
    if (agents.length === 0) {
      return '<div class="empty-state"><div class="empty-state-text">No agents</div></div>';
    }

    if (!activeLogAgent) activeLogAgent = agents[0].name;

    const tabs = agents.map(a =>
      `<button class="log-tab ${a.name === activeLogAgent ? 'active' : ''}" onclick="app.selectLogAgent('${a.name}')">${escapeHtml(a.name)}</button>`
    ).join('');

    return `
      <div class="card">
        <div class="log-tabs">${tabs}</div>
        <div class="log-container" id="log-container">
          <div style="color: var(--text-dim);">Loading...</div>
        </div>
      </div>
    `;
  }

  function selectLogAgent(agent) {
    activeLogAgent = agent;
    // Update tab active state
    document.querySelectorAll('.log-tab').forEach(tab => {
      tab.classList.toggle('active', tab.textContent.trim() === agent);
    });
    loadAndRenderLog();
  }

  async function loadAndRenderLog() {
    if (!currentTeamId || !activeLogAgent) return;

    // Load from API if not cached
    if (!logData[currentTeamId]?.[activeLogAgent]) {
      const data = await api(`/teams/${currentTeamId}/logs/${activeLogAgent}?limit=1000`);
      if (!logData[currentTeamId]) logData[currentTeamId] = {};
      logData[currentTeamId][activeLogAgent] = data.lines || [];
    }

    const container = $('log-container');
    if (!container) return;

    const lines = logData[currentTeamId][activeLogAgent] || [];
    container.innerHTML = lines.length > 0
      ? lines.map(l => `<div class="log-line">${escapeHtml(l)}</div>`).join('')
      : '<div style="color: var(--text-dim);">No logs yet</div>';

    // Auto-scroll to bottom
    container.scrollTop = container.scrollHeight;
  }

  function appendLogLines(lines) {
    const container = $('log-container');
    if (!container) return;

    const wasAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 50;

    lines.forEach(line => {
      const div = document.createElement('div');
      div.className = 'log-line';
      div.textContent = line;
      container.appendChild(div);
    });

    if (wasAtBottom) {
      container.scrollTop = container.scrollHeight;
    }
  }

  // ── Reports View ──
  function renderReportsViewHTML() {
    return '<div id="reports-container"><div style="color: var(--text-dim);">Loading...</div></div>';
  }

  async function renderReportsView() {
    if (!currentTeamId) return;
    const data = await api(`/teams/${currentTeamId}/reports`);
    const reports = data.reports || [];

    const container = $('reports-container');
    if (!container) return;

    if (reports.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-text">No reports yet</div></div>';
      return;
    }

    container.innerHTML = reports.map(r => `
      <div class="report-card">
        <div class="report-header">
          <span class="report-agent">${escapeHtml(r.agent || r.file)}</span>
          <span class="report-task">${escapeHtml(r.task_id || '')}</span>
        </div>
        <div class="report-body">${escapeHtml(r.summary || r.result || '')}</div>
        ${r.files_created?.length ? `<div class="report-files">Created: ${r.files_created.map(f => escapeHtml(f)).join(', ')}</div>` : ''}
        ${r.files_modified?.length ? `<div class="report-files" style="color: var(--accent-yellow);">Modified: ${r.files_modified.map(f => escapeHtml(f)).join(', ')}</div>` : ''}
        ${r.decisions?.length ? `<div style="margin-top: 6px; font-size: 12px; color: var(--text-muted);">Decisions: ${r.decisions.map(d => escapeHtml(d)).join('; ')}</div>` : ''}
        ${r.blockers?.length ? `<div style="margin-top: 6px; font-size: 12px; color: var(--accent-red);">Blockers: ${r.blockers.map(b => escapeHtml(b)).join('; ')}</div>` : ''}
      </div>
    `).join('');
  }

  // ── Review Panel ──
  async function loadAndRenderReview() {
    if (!currentTeamId) return;
    const container = $('review-container');
    if (!container) return;

    try {
      reviewData = await api(`/teams/${currentTeamId}/review`);
    } catch {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-text">Failed to load review data</div></div>';
      return;
    }

    if (!reviewData.has_review) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-text">No review checkpoint in this pipeline</div></div>';
      return;
    }

    if (reviewData.is_completed) {
      container.innerHTML = `
        <div class="review-approved">
          <div class="review-approved-icon">&#10003;</div>
          <div class="review-approved-text">Review approved — development is in progress</div>
        </div>
        ${renderReviewDocuments(reviewData.documents)}
      `;
      return;
    }

    if (!reviewData.is_pending) {
      if (reviewData.is_rejected) {
        container.innerHTML = `
          <div class="review-waiting">
            <div style="font-size: 42px; margin-bottom: 12px;">&#128260;</div>
            <div class="review-waiting-text">Changes requested — regenerating...</div>
            <div class="review-waiting-sub">
              Your feedback has been sent. The planner agent is regenerating the documents.
              ${reviewData.rejection_feedback ? `<br><br><strong>Your feedback:</strong> ${escapeHtml(reviewData.rejection_feedback)}` : ''}
            </div>
            <div class="loading-spinner" style="margin-top: 18px;"></div>
          </div>
        `;
      } else {
        container.innerHTML = `
          <div class="review-waiting">
            <div class="loading-spinner"></div>
            <div class="review-waiting-text">Waiting for planning phase to complete...</div>
            <div class="review-waiting-sub">The review will be available once PRD is finished.</div>
          </div>
        `;
      }
      return;
    }

    // Review is pending — show documents + approve/reject
    container.innerHTML = `
      <div class="review-panel">
        <div class="review-panel-header">
          <h3>Review Planning Documents</h3>
          <p>The planning phase is complete. Review the documents below and approve to start development, or request changes.</p>
        </div>
        ${renderReviewDocuments(reviewData.documents)}
        <div class="review-actions">
          <div class="review-feedback-group">
            <label class="form-label">Feedback (optional, for rejection)</label>
            <textarea class="form-textarea" id="review-feedback" rows="3" placeholder="Describe what needs to change..."></textarea>
          </div>
          <div class="review-buttons">
            <button class="btn btn-danger" id="btn-reject" onclick="app.rejectReview()">Request Changes</button>
            <button class="btn btn-primary btn-lg" id="btn-approve" onclick="app.approveReview()">Approve &amp; Start Development</button>
          </div>
        </div>
      </div>
    `;
  }

  function renderReviewDocuments(docs) {
    if (!docs || Object.keys(docs).length === 0) {
      return '<div class="review-no-docs">No documents generated yet. Planning agents may still be writing.</div>';
    }

    const sections = [];

    if (docs.prd) {
      sections.push({ title: 'PRD (Product Requirements)', icon: '&#128196;', content: docs.prd, lang: 'markdown' });
    }
    if (docs.stack) {
      sections.push({ title: 'Tech Stack', icon: '&#9881;', content: docs.stack, lang: 'json' });
    }
    if (docs.tasks) {
      sections.push({ title: 'Development Tasks', icon: '&#9776;', content: docs.tasks, lang: 'json' });
    }
    if (docs.design) {
      sections.push({ title: 'Design Spec', icon: '&#127912;', content: docs.design, lang: 'json' });
    }
    if (docs.analysis) {
      sections.push({ title: 'Code Analysis', icon: '&#128269;', content: docs.analysis, lang: 'json' });
    }
    if (docs.change_plan) {
      sections.push({ title: 'Change Plan', icon: '&#128221;', content: docs.change_plan, lang: 'markdown' });
    }

    return sections.map((s, i) => `
      <div class="review-doc">
        <div class="review-doc-header" onclick="app.toggleReviewDoc(${i})">
          <span class="review-doc-icon">${s.icon}</span>
          <span class="review-doc-title">${s.title}</span>
          <span class="review-doc-toggle" id="review-toggle-${i}">&#9660;</span>
        </div>
        <div class="review-doc-body" id="review-doc-${i}">
          <pre class="review-doc-content">${escapeHtml(s.content)}</pre>
        </div>
      </div>
    `).join('');
  }

  function toggleReviewDoc(index) {
    const body = $(`review-doc-${index}`);
    const toggle = $(`review-toggle-${index}`);
    if (!body) return;
    const isOpen = body.style.display !== 'none';
    body.style.display = isOpen ? 'none' : 'block';
    if (toggle) toggle.innerHTML = isOpen ? '&#9654;' : '&#9660;';
  }

  async function approveReview() {
    if (!currentTeamId) return;
    const btn = $('btn-approve');
    if (btn) { btn.textContent = 'Approving...'; btn.disabled = true; }

    try {
      const result = await api(`/pipeline/${currentTeamId}/review`, {
        method: 'POST',
        body: JSON.stringify({ action: 'approve' }),
      });
      if (result.success) {
        // Refresh
        await loadTeamDetail(currentTeamId);
        renderTeamView();
      } else {
        alert(result.error || 'Failed to approve');
      }
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      if (btn) { btn.textContent = 'Approve & Start Development'; btn.disabled = false; }
    }
  }

  async function rejectReview() {
    if (!currentTeamId) return;
    const feedback = ($('review-feedback')?.value || '').trim();
    if (!feedback) {
      $('review-feedback').style.borderColor = 'var(--accent-red)';
      $('review-feedback').placeholder = 'Please provide feedback for what needs to change...';
      $('review-feedback').focus();
      return;
    }

    const btn = $('btn-reject');
    if (btn) { btn.textContent = 'Sending...'; btn.disabled = true; }

    try {
      const result = await api(`/pipeline/${currentTeamId}/review`, {
        method: 'POST',
        body: JSON.stringify({ action: 'reject', feedback }),
      });
      if (result.success) {
        await loadTeamDetail(currentTeamId);
        renderTeamView();
      } else {
        alert(result.error || 'Failed to reject');
      }
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      if (btn) { btn.textContent = 'Request Changes'; btn.disabled = false; }
    }
  }

  // ── Specs Editor ──
  async function loadAndRenderSpecs() {
    if (!currentTeamId) return;
    const container = $('specs-container');
    if (!container) return;

    try {
      const data = await api(`/teams/${currentTeamId}/specs`);
      specsData = data.specs || {};
      specsOriginal = { ...specsData };
      specsDirty = {};
    } catch {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-text">Failed to load specs</div></div>';
      return;
    }

    renderSpecsEditor();
  }

  function renderSpecsEditor() {
    const container = $('specs-container');
    if (!container) return;

    const specKeys = [
      { key: 'prd', label: 'PRD', icon: '&#128196;' },
      { key: 'stack', label: 'Stack', icon: '&#9881;' },
      { key: 'tasks', label: 'Tasks', icon: '&#9776;' },
      { key: 'design', label: 'Design', icon: '&#127912;' },
    ];

    // Check if planning is still incomplete (for Skip to Dev button)
    const tasks = teamDetail?.tasks || [];
    const planningIncomplete = tasks.some(t =>
      ['planner', 'architect', 'designer', '__review__'].includes(t.assigned_to) && t.status !== 'completed'
    );

    const tabs = specKeys.map(s => {
      const hasDirty = specsDirty[s.key] ? ' spec-tab-dirty' : '';
      const hasContent = specsData?.[s.key] ? '' : ' spec-tab-empty';
      return `<button class="spec-tab${activeSpecKey === s.key ? ' active' : ''}${hasDirty}${hasContent}" onclick="app.selectSpec('${s.key}')">${s.icon} ${s.label}</button>`;
    }).join('');

    const content = specsData?.[activeSpecKey] || '';
    const isDirty = specsDirty[activeSpecKey] || false;

    container.innerHTML = `
      <div class="card">
        <div class="spec-tabs">${tabs}</div>
        <div class="spec-editor-container">
          <textarea class="spec-editor" id="spec-editor" spellcheck="false"
            placeholder="No content yet. Paste or type your spec here..."
            oninput="app.onSpecEdit()">${escapeHtml(content)}</textarea>
        </div>
        <div class="spec-actions">
          <div class="spec-actions-left">
            ${planningIncomplete ? `<button class="btn btn-sm" style="color: var(--accent-yellow); border-color: rgba(227,179,65,0.4);" onclick="app.skipToDev()">Skip to Dev</button>` : ''}
          </div>
          <div class="spec-actions-right">
            <button class="btn btn-sm" onclick="app.revertSpec()" ${isDirty ? '' : 'disabled'}>Revert</button>
            <button class="btn btn-primary btn-sm" onclick="app.saveSpec()" ${isDirty ? '' : 'disabled'}>Save</button>
          </div>
        </div>
      </div>
    `;
  }

  function selectSpec(key) {
    activeSpecKey = key;
    renderSpecsEditor();
  }

  function onSpecEdit() {
    const editor = $('spec-editor');
    if (!editor) return;
    const current = editor.value;
    specsDirty[activeSpecKey] = current !== (specsOriginal[activeSpecKey] || '');
    // Update button states without full re-render
    const btns = document.querySelectorAll('.spec-actions .btn');
    btns.forEach(btn => {
      if (btn.textContent.trim() === 'Revert' || btn.textContent.trim() === 'Save') {
        btn.disabled = !specsDirty[activeSpecKey];
      }
    });
    // Update tab dirty indicator
    const tabs = document.querySelectorAll('.spec-tab');
    tabs.forEach(tab => {
      if (tab.textContent.includes(activeSpecKey.charAt(0).toUpperCase() + activeSpecKey.slice(1).split('')[0])) {
        tab.classList.toggle('spec-tab-dirty', specsDirty[activeSpecKey]);
      }
    });
  }

  async function saveSpec() {
    const editor = $('spec-editor');
    if (!editor || !currentTeamId) return;

    try {
      const result = await api(`/teams/${currentTeamId}/specs/${activeSpecKey}`, {
        method: 'PUT',
        body: JSON.stringify({ content: editor.value }),
      });
      if (result.success) {
        specsData[activeSpecKey] = editor.value;
        specsOriginal[activeSpecKey] = editor.value;
        specsDirty[activeSpecKey] = false;
        showToast('Spec saved', 'success');
        renderSpecsEditor();
      } else {
        showToast(result.error || 'Failed to save', 'error');
      }
    } catch (err) {
      showToast('Error saving spec', 'error');
    }
  }

  function revertSpec() {
    if (!specsOriginal) return;
    specsData[activeSpecKey] = specsOriginal[activeSpecKey] || '';
    specsDirty[activeSpecKey] = false;
    renderSpecsEditor();
    showToast('Reverted to saved version');
  }

  async function skipToDev() {
    if (!currentTeamId) return;
    if (!confirm('Skip planning and start development? Planning tasks will be marked as completed.')) return;

    try {
      const result = await api(`/teams/${currentTeamId}/specs/skip`, { method: 'POST' });
      if (result.success) {
        showToast(`Skipped ${result.skipped?.length || 0} tasks`, 'success');
        await loadTeamDetail(currentTeamId);
        renderTeamView();
      } else {
        showToast(result.error || 'Failed to skip', 'error');
      }
    } catch {
      showToast('Error skipping to dev', 'error');
    }
  }

  // ── Chat View ──
  function renderChatView() {
    return `
      <div class="chat-panel" id="chat-panel">
        <div class="chat-messages" id="chat-messages">
          <div class="chat-empty">Start a conversation about your project</div>
        </div>
        <div class="chat-input-area">
          <textarea class="chat-input" id="chat-input" rows="2"
            placeholder="Ask about your project, request changes, get explanations..."
            onkeydown="app.chatKeyDown(event)"></textarea>
          <div class="chat-input-actions">
            <button class="btn btn-sm btn-ghost" onclick="app.clearChat()" data-tooltip="Clear history">Clear</button>
            <button class="btn btn-primary btn-sm" id="chat-send-btn" onclick="app.sendChatMessage()">Send</button>
          </div>
        </div>
      </div>
    `;
  }

  async function loadChat() {
    if (!currentTeamId) return;
    try {
      const data = await api(`/teams/${currentTeamId}/chat`);
      chatMessages = data.messages || [];
    } catch {
      chatMessages = [];
    }
    renderChatMessages();
    // Focus input
    const input = $('chat-input');
    if (input) input.focus();
  }

  function renderChatMessages() {
    const container = $('chat-messages');
    if (!container) return;

    if (chatMessages.length === 0 && !chatLoading) {
      container.innerHTML = '<div class="chat-empty">Start a conversation about your project</div>';
      return;
    }

    container.innerHTML = chatMessages.map(m => `
      <div class="chat-msg chat-msg-${m.role}">
        <div class="chat-msg-label">${m.role === 'user' ? 'You' : 'AI'}</div>
        <div class="chat-msg-content">${escapeHtml(m.content)}</div>
      </div>
    `).join('') + (chatLoading ? `
      <div class="chat-msg chat-msg-assistant">
        <div class="chat-msg-label">AI</div>
        <div class="chat-msg-content chat-streaming" id="chat-stream">${escapeHtml(chatStreamBuffer) || '<span class="chat-typing">Thinking...</span>'}</div>
      </div>
    ` : '');

    container.scrollTop = container.scrollHeight;
  }

  function updateChatStream() {
    const el = $('chat-stream');
    if (el) {
      el.textContent = chatStreamBuffer;
      const container = $('chat-messages');
      if (container) container.scrollTop = container.scrollHeight;
    }
  }

  async function sendChatMessage() {
    const input = $('chat-input');
    if (!input || !currentTeamId) return;
    const message = input.value.trim();
    if (!message) return;
    if (chatLoading) return;

    // Add to local state immediately
    chatMessages.push({ id: `msg_${Date.now()}`, role: 'user', content: message, ts: new Date().toISOString() });
    chatLoading = true;
    chatStreamBuffer = '';
    input.value = '';
    renderChatMessages();

    try {
      await api(`/teams/${currentTeamId}/chat`, {
        method: 'POST',
        body: JSON.stringify({ message }),
      });
    } catch {
      chatLoading = false;
      showToast('Failed to send message', 'error');
      renderChatMessages();
    }
  }

  function chatKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  }

  async function clearChat() {
    if (!currentTeamId) return;
    if (!confirm('Clear chat history?')) return;
    try {
      await api(`/teams/${currentTeamId}/chat/clear`, { method: 'POST' });
      chatMessages = [];
      chatStreamBuffer = '';
      renderChatMessages();
      showToast('Chat cleared');
    } catch {
      showToast('Failed to clear chat', 'error');
    }
  }

  // ── Pipeline Actions ──
  function showNewPipelineModal() {
    $('modal-new-pipeline').style.display = 'flex';
    $('input-idea').focus();
  }

  function hideNewPipelineModal() {
    $('modal-new-pipeline').style.display = 'none';
    $('input-name').value = '';
    $('input-idea').value = '';
    $('input-project-dir').value = '';
  }

  // ── Folder Browser ──
  let folderBrowserPath = '';

  function showImportModal() {
    $('modal-import').style.display = 'flex';
    $('input-import-prompt').focus();
  }

  function hideImportModal() {
    $('modal-import').style.display = 'none';
    $('input-import-name').value = '';
    $('input-import-dir').value = '';
    $('input-import-prompt').value = '';
    $('folder-browser').style.display = 'none';
    const selected = $('folder-picker-selected');
    if (selected) selected.innerHTML = '<span class="folder-picker-placeholder">Select a project folder...</span>';
  }

  async function openFolderBrowser() {
    const browser = $('folder-browser');
    if (browser.style.display !== 'none') {
      browser.style.display = 'none';
      return;
    }
    browser.style.display = 'block';
    // Start from home dir or last browsed path
    await browseTo(folderBrowserPath || '~');
  }

  async function browseTo(dirPath) {
    const list = $('folder-browser-list');
    const pathEl = $('folder-browser-path');
    const footer = $('folder-browser-footer');
    if (!list) return;

    list.innerHTML = '<div style="padding: 12px; color: var(--text-dim);">Loading...</div>';
    if (footer) footer.innerHTML = '';

    try {
      const data = await api(`/browse?path=${encodeURIComponent(dirPath)}`);
      if (data.error) {
        list.innerHTML = `<div style="padding: 12px; color: var(--accent-red);">${escapeHtml(data.error)}</div>`;
        return;
      }

      folderBrowserPath = data.path;
      if (pathEl) pathEl.textContent = data.path;

      // Folder list — click navigates into subfolder (use data attributes to avoid escaping issues)
      if (data.entries.length === 0) {
        list.innerHTML = '<div style="padding: 12px; color: var(--text-dim);">No subdirectories</div>';
      } else {
        list.innerHTML = data.entries.map(e => `
          <div class="folder-browser-item" data-path="${encodeURIComponent(e.path)}">
            <span class="folder-icon">&#128193;</span>
            <span class="folder-name">${escapeHtml(e.name)}</span>
            ${e.is_project ? '<span class="folder-project-hint">project</span>' : ''}
          </div>
        `).join('');
      }

      // Attach click handlers via event delegation (avoids quote/path escaping issues)
      list.onclick = (e) => {
        const item = e.target.closest('.folder-browser-item');
        if (item?.dataset.path) browseTo(decodeURIComponent(item.dataset.path));
      };

      // Footer — select current folder button
      if (footer) {
        const currentName = data.path.split('/').pop() || data.path;
        footer.innerHTML = `
          <button class="btn btn-primary btn-sm folder-select-btn" id="folder-select-current">
            Select this folder${data.is_project ? ' (project detected)' : ''}
          </button>
        `;
        $('folder-select-current').onclick = () => selectFolder(data.path, currentName);
      }
    } catch (err) {
      list.innerHTML = `<div style="padding: 12px; color: var(--accent-red);">Error: ${escapeHtml(err.message)}</div>`;
    }
  }

  function folderBrowserUp() {
    if (!folderBrowserPath) return;
    const parent = folderBrowserPath.split('/').slice(0, -1).join('/') || '/';
    browseTo(parent);
  }

  function selectFolder(path, name) {
    $('input-import-dir').value = path;
    const selected = $('folder-picker-selected');
    if (selected) {
      selected.innerHTML = `<span class="folder-icon">&#128193;</span> <span>${escapeHtml(path)}</span>`;
    }
    // Auto-fill project name if empty
    const nameInput = $('input-import-name');
    if (nameInput && !nameInput.value.trim()) {
      nameInput.value = name;
    }
    $('folder-browser').style.display = 'none';
    showToast('Folder selected: ' + name);
  }

  async function startPipeline() {
    const idea = $('input-idea').value.trim();
    if (!idea) {
      $('input-idea').style.borderColor = 'var(--accent-red)';
      $('input-idea').focus();
      showToast('Please enter an idea', 'error');
      return;
    }
    $('input-idea').style.borderColor = '';

    const projectName = $('input-name').value.trim() || undefined;
    const projectDir = $('input-project-dir').value.trim() || undefined;

    $('btn-start').textContent = 'Starting...';
    $('btn-start').disabled = true;

    try {
      const result = await api('/pipeline/start', {
        method: 'POST',
        body: JSON.stringify({ idea, project_name: projectName, project_dir: projectDir }),
      });

      hideNewPipelineModal();
      showToast('Pipeline started');

      // Poll until team appears, then navigate
      await waitForTeamAndNavigate(result.team_id);
    } catch (err) {
      showToast('Failed to start pipeline', 'error');
    } finally {
      $('btn-start').textContent = 'Create';
      $('btn-start').disabled = false;
    }
  }

  async function waitForTeamAndNavigate(teamId) {
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 1500));
      await loadTeams();
      if (teamId && teams.some(t => t.id === teamId)) {
        navigate(`#/team/${teamId}`);
        return;
      }
      // If no teamId, check for any new team
      if (!teamId && teams.length > 0) {
        navigate(`#/team/${teams[0].id}`);
        return;
      }
    }
    // Fallback
    if (teamId) navigate(`#/team/${teamId}`);
  }

  async function startImport() {
    const projectDir = $('input-import-dir').value.trim();
    const prompt = $('input-import-prompt').value.trim();

    if (!projectDir) {
      $('folder-picker-selected').style.borderColor = 'var(--accent-red)';
      showToast('Please select a project folder', 'error');
      return;
    }
    $('folder-picker-selected').style.borderColor = '';

    if (!prompt) {
      $('input-import-prompt').style.borderColor = 'var(--accent-red)';
      $('input-import-prompt').focus();
      showToast('Please describe what you want to change', 'error');
      return;
    }
    $('input-import-prompt').style.borderColor = '';

    $('btn-import-start').textContent = 'Starting...';
    $('btn-import-start').disabled = true;

    const projectName = $('input-import-name').value.trim() || undefined;

    try {
      const result = await api('/pipeline/start', {
        method: 'POST',
        body: JSON.stringify({ idea: prompt, project_name: projectName, project_dir: projectDir }),
      });

      hideImportModal();
      showToast('Modify pipeline started');

      await waitForTeamAndNavigate(result.team_id);
    } catch (err) {
      showToast('Failed to start import', 'error');
    } finally {
      $('btn-import-start').textContent = 'Start Modify';
      $('btn-import-start').disabled = false;
    }
  }

  async function stopPipeline(teamId) {
    if (!confirm('Stop this pipeline? Running agents will be terminated.')) return;
    await api(`/pipeline/${teamId}/stop`, { method: 'POST' });
    showToast('Pipeline stopped');
    // Immediately update local state so UI reflects the change
    if (teamDetail) {
      teamDetail.status = 'stopped';
      teamDetail.agents.forEach(a => { a.alive = false; a.status = 'stopped'; });
      renderTeamView();
    }
    await loadTeams();
    setTimeout(async () => {
      await loadTeamDetail(teamId);
      renderTeamView();
    }, 1000);
  }

  async function deletePipeline(teamId) {
    const name = teamDetail?.team_name || teamId;
    if (!confirm(`Delete pipeline "${name}"?\nThis removes all team data (logs, reports, queue). Project source files are not affected.`)) return;
    await api(`/pipeline/${teamId}/delete`, { method: 'POST' });
    showToast('Pipeline deleted');
    currentTeamId = null;
    teamDetail = null;
    await loadTeams();
    navigate('#/');
  }

  async function resumePipeline(teamId) {
    await api(`/pipeline/${teamId}/resume`, { method: 'POST' });
    showToast('Pipeline resumed');
    setTimeout(async () => {
      await loadTeamDetail(teamId);
      renderTeamView();
    }, 2000);
  }

  async function rerunTask(teamId, taskId) {
    if (!confirm(`Rerun task ${taskId}?`)) return;
    await api(`/pipeline/${teamId}/rerun/${taskId}`, { method: 'POST' });
    showToast('Task rerun started');
    setTimeout(async () => {
      await loadTeamDetail(teamId);
      renderTeamView();
    }, 2000);
  }

  // ── Send Prompt ──
  async function sendPrompt() {
    if (!teamDetail?.project_dir) return;
    const prompt = ($('prompt-input')?.value || '').trim();
    if (!prompt) {
      $('prompt-input').style.borderColor = 'var(--accent-red)';
      $('prompt-input').focus();
      showToast('Please enter a prompt', 'error');
      return;
    }
    $('prompt-input').style.borderColor = '';

    const btn = $('btn-send-prompt');
    if (btn) { btn.textContent = 'Starting...'; btn.disabled = true; }

    const projectName = teamDetail.team_name.replace(/_\d{8}_\d{6}$/, '');

    try {
      const result = await api('/pipeline/start', {
        method: 'POST',
        body: JSON.stringify({
          idea: prompt,
          project_name: projectName || undefined,
          project_dir: teamDetail.project_dir,
        }),
      });

      showToast('New pipeline started', 'success');
      $('prompt-input').value = '';

      await waitForTeamAndNavigate(result.team_id);
    } catch (err) {
      showToast('Failed to start pipeline', 'error');
    } finally {
      if (btn) { btn.textContent = 'Run'; btn.disabled = false; }
    }
  }

  // ── Init ──
  async function init() {
    await loadTeams();

    // Start polling teams list every 10s
    pollInterval = setInterval(loadTeams, 10000);

    // Handle initial route
    handleRoute();

    // If we're on reports view, load reports
    if (currentView === 'reports') {
      renderReportsView();
    }
  }

  // ── Keyboard shortcuts ──
  document.addEventListener('keydown', (e) => {
    // Escape to close modals
    if (e.key === 'Escape') {
      const modal1 = $('modal-new-pipeline');
      if (modal1 && modal1.style.display !== 'none') {
        hideNewPipelineModal();
      }
      const modal2 = $('modal-import');
      if (modal2 && modal2.style.display !== 'none') {
        const fb = $('folder-browser');
        if (fb && fb.style.display !== 'none') {
          fb.style.display = 'none';
        } else {
          hideImportModal();
        }
      }
    }
    // Ctrl/Cmd + N for new pipeline
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
      e.preventDefault();
      showNewPipelineModal();
    }
  });

  // Start
  init();

  // ── Public API ──
  return {
    showNewPipelineModal,
    hideNewPipelineModal,
    showImportModal,
    hideImportModal,
    openFolderBrowser,
    browseTo,
    folderBrowserUp,
    selectFolder,
    startPipeline,
    startImport,
    sendPrompt,
    stopPipeline,
    deletePipeline,
    resumePipeline,
    rerunTask,
    switchView,
    selectLogAgent,
    toggleReviewDoc,
    approveReview,
    rejectReview,
    // Specs
    selectSpec,
    onSpecEdit,
    saveSpec,
    revertSpec,
    skipToDev,
    // Chat
    sendChatMessage,
    chatKeyDown,
    clearChat,
  };
})();
