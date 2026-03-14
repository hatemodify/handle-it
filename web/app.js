// ═══════════════════════════════════════════════════
//  handle-it Web UI — Frontend SPA
//  Router + Views + SSE Client + Dependency Graph
// ═══════════════════════════════════════════════════

const app = (() => {
  // ── State ──
  let currentTeamId = null;
  let currentView = 'overview'; // overview | logs | reports
  let teams = [];
  let teamDetail = null;
  let eventSource = null;
  let logData = {};        // { agent: [lines] }
  let activeLogAgent = null;
  let pollInterval = null;

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
        teamDetail.tasks = data.tasks;
        if (currentView === 'overview') renderTeamView();
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

    eventSource.addEventListener('heartbeat', () => {
      setConnectionStatus(true);
    });

    eventSource.onopen = () => setConnectionStatus(true);
    eventSource.onerror = () => setConnectionStatus(false);
  }

  function setConnectionStatus(connected) {
    const dot = document.getElementById('connection-dot');
    const text = document.getElementById('connection-text');
    if (dot) dot.className = connected ? 'connection-dot' : 'connection-dot disconnected';
    if (text) text.textContent = connected ? 'Connected' : 'Disconnected';
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
          <div class="empty-state-icon">&#9881;</div>
          <div class="empty-state-text">No pipelines yet. Start one to begin.</div>
          <button class="btn btn-primary" onclick="app.showNewPipelineModal()">+ New Pipeline</button>
        </div>
      `);
    } else {
      renderMain(`
        <h2 style="color: var(--text-primary); margin-bottom: 16px;">All Teams</h2>
        <div class="grid-2">
          ${teams.map(t => {
            const pct = t.progress.total > 0 ? Math.round(t.progress.completed / t.progress.total * 100) : 0;
            return `
              <div class="card" style="cursor: pointer;" onclick="location.hash='#/team/${t.id}'">
                <div class="card-header">
                  <span class="card-title">${escapeHtml(t.team_name)}</span>
                  <span class="status-text" style="color: ${t.status === 'active' ? 'var(--accent-green)' : 'var(--text-dim)'}">${t.status}</span>
                </div>
                <div class="card-body">
                  <div class="progress-bar" style="height: 8px; border-radius: 4px;">
                    <div class="progress-fill" style="width: ${pct}%; border-radius: 4px;"></div>
                  </div>
                  <div style="margin-top: 8px; font-size: 12px; color: var(--text-muted);">
                    ${t.progress.completed}/${t.progress.total} completed
                    ${t.progress.failed > 0 ? ` &middot; <span style="color: var(--accent-red)">${t.progress.failed} failed</span>` : ''}
                    ${t.progress.in_progress > 0 ? ` &middot; <span style="color: var(--accent-blue)">${t.progress.in_progress} running</span>` : ''}
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `);
    }
  }

  // ── Team View ──
  function renderTeamView() {
    if (!teamDetail) return;

    const tabs = `
      <div class="nav-tabs">
        <button class="nav-tab ${currentView === 'overview' ? 'active' : ''}" onclick="app.switchView('overview')">Overview</button>
        <button class="nav-tab ${currentView === 'logs' ? 'active' : ''}" onclick="app.switchView('logs')">Logs</button>
        <button class="nav-tab ${currentView === 'reports' ? 'active' : ''}" onclick="app.switchView('reports')">Reports</button>
      </div>
    `;

    const actions = `
      <div style="display: flex; gap: 8px; margin-bottom: 16px; align-items: center;">
        <h2 style="color: var(--text-primary); flex: 1;">${escapeHtml(teamDetail.team_name)}</h2>
        ${teamDetail.status === 'active' ?
          `<button class="btn btn-danger btn-sm" onclick="app.stopPipeline('${teamDetail.id}')">Stop</button>` :
          `<button class="btn btn-sm" onclick="app.resumePipeline('${teamDetail.id}')">Resume</button>`
        }
      </div>
    `;

    let content = '';
    switch (currentView) {
      case 'overview':
        content = renderOverview();
        break;
      case 'logs':
        content = renderLogsView();
        break;
      case 'reports':
        content = renderReportsViewHTML();
        break;
    }

    renderMain(actions + tabs + content);

    // Post-render hooks
    if (currentView === 'overview') {
      renderDependencyGraph();
    }
    if (currentView === 'logs') {
      if (!activeLogAgent && teamDetail.agents.length > 0) {
        activeLogAgent = teamDetail.agents[0].name;
      }
      loadAndRenderLog();
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
              <thead><tr><th>Status</th><th>ID</th><th>Task</th><th>Agent</th><th></th></tr></thead>
              <tbody>
                ${tasks.map(t => `
                  <tr>
                    <td class="status-${t.status}"><span class="status-dot"></span><span class="status-text">${t.status}</span></td>
                    <td style="font-family: var(--font-mono); font-size: 12px;">${escapeHtml(t.id)}</td>
                    <td>${escapeHtml(t.subject)}</td>
                    <td style="color: var(--accent-purple);">${escapeHtml(t.owner || '-')}</td>
                    <td>${t.status === 'failed' || t.status === 'completed' ?
                      `<button class="btn btn-sm" onclick="app.rerunTask('${teamDetail.id}', '${t.id}')">Rerun</button>` : ''
                    }</td>
                  </tr>
                `).join('')}
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
    `;
  }

  function renderAgentCards() {
    const container = $('agents-container');
    if (container) container.innerHTML = renderAgentCardsHTML();
  }

  function renderAgentCardsHTML() {
    const agents = teamDetail?.agents || [];
    if (agents.length === 0) return '<div style="color: var(--text-dim); font-size: 13px;">No agents</div>';

    return `<div class="agents-grid">${agents.map(a => `
      <div class="agent-card ${a.alive ? 'alive' : 'dead'}">
        <div class="agent-name">${escapeHtml(a.name)}</div>
        <div class="agent-role">${escapeHtml(a.role || '')}</div>
        <div class="agent-status ${a.alive ? 'agent-alive' : 'agent-dead'}">
          ${a.alive ? '&#9679; alive' : '&#9675; stopped'}
          ${(a.respawn_count || 0) > 0 ? ` (respawn: ${a.respawn_count})` : ''}
        </div>
      </div>
    `).join('')}</div>`;
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

  // ── Pipeline Actions ──
  function showNewPipelineModal() {
    $('modal-new-pipeline').style.display = 'flex';
    $('input-idea').focus();
  }

  function hideNewPipelineModal() {
    $('modal-new-pipeline').style.display = 'none';
    $('input-idea').value = '';
    $('input-project-dir').value = '';
  }

  async function startPipeline() {
    const idea = $('input-idea').value.trim();
    if (!idea) {
      $('input-idea').style.borderColor = 'var(--accent-red)';
      return;
    }
    $('input-idea').style.borderColor = '';

    const projectDir = $('input-project-dir').value.trim() || undefined;

    $('btn-start').textContent = 'Starting...';
    $('btn-start').disabled = true;

    try {
      const result = await api('/pipeline/start', {
        method: 'POST',
        body: JSON.stringify({ idea, project_dir: projectDir }),
      });

      hideNewPipelineModal();

      // Refresh teams after a delay (pipeline needs time to initialize)
      setTimeout(async () => {
        await loadTeams();
        if (result.team_id) {
          navigate(`#/team/${result.team_id}`);
        }
      }, 4000);
    } catch (err) {
      console.error('Failed to start pipeline:', err);
    } finally {
      $('btn-start').textContent = 'Start';
      $('btn-start').disabled = false;
    }
  }

  async function stopPipeline(teamId) {
    if (!confirm('Stop this pipeline? Running agents will be terminated.')) return;
    await api(`/pipeline/${teamId}/stop`, { method: 'POST' });
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

  async function resumePipeline(teamId) {
    await api(`/pipeline/${teamId}/resume`, { method: 'POST' });
    setTimeout(() => {
      loadTeamDetail(teamId).then(() => renderTeamView());
    }, 2000);
  }

  async function rerunTask(teamId, taskId) {
    if (!confirm(`Rerun task ${taskId}?`)) return;
    await api(`/pipeline/${teamId}/rerun/${taskId}`, { method: 'POST' });
    setTimeout(() => {
      loadTeamDetail(teamId).then(() => renderTeamView());
    }, 2000);
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
    // Escape to close modal
    if (e.key === 'Escape') {
      const modal = $('modal-new-pipeline');
      if (modal && modal.style.display !== 'none') {
        hideNewPipelineModal();
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
    startPipeline,
    stopPipeline,
    resumePipeline,
    rerunTask,
    switchView,
    selectLogAgent,
  };
})();
