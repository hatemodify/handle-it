#!/usr/bin/env node
// ═══════════════════════════════════════════════════
//  autodev-teams — CLI 진입점
//  Node.js → bash 브릿지 + 프로젝트 config 지원
// ═══════════════════════════════════════════════════
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { spawn } from 'child_process';
import { existsSync, chmodSync, writeFileSync, readFileSync } from 'fs';

const __dir  = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT    = join(__dir, '..');
const SCRIPTS_DIR = join(PKG_ROOT, 'scripts');
const PROMPTS_DIR = join(PKG_ROOT, 'prompts');

const VERSION = JSON.parse(
  readFileSync(join(PKG_ROOT, 'package.json'), 'utf-8')
).version;

// ── shell 스크립트 실행 권한 보장 ──
const shellFiles = [
  join(SCRIPTS_DIR, 'autodev.sh'),
  join(SCRIPTS_DIR, 'install.sh'),
  join(SCRIPTS_DIR, 'watch.sh'),
  join(SCRIPTS_DIR, 'dashboard.sh'),
  join(SCRIPTS_DIR, 'lib', 'logger.sh'),
  join(SCRIPTS_DIR, 'lib', 'task_queue.sh'),
  join(SCRIPTS_DIR, 'lib', 'messenger.sh'),
  join(SCRIPTS_DIR, 'lib', 'team_manager.sh'),
];
shellFiles.forEach(f => {
  if (existsSync(f)) {
    try { chmodSync(f, '755'); } catch {}
  }
});

// ── CLI 파싱 ──
const args    = process.argv.slice(2);
const command = args[0];

// ─────────────────────────────────────
//  autodev --version / -v
// ─────────────────────────────────────
if (command === '--version' || command === '-v') {
  console.log(`handle-it v${VERSION}`);
  process.exit(0);
}

// ─────────────────────────────────────
//  autodev --help / -h
// ─────────────────────────────────────
if (!command || command === '--help' || command === '-h') {
  console.log(`
  \x1b[1mhandle-it\x1b[0m v${VERSION}
  AI-powered autonomous development pipeline

  \x1b[1m사용법:\x1b[0m
    handle-it "<아이디어>"              프로젝트 자동 생성
    handle-it "<아이디어>" [경로]       출력 경로 지정
    handle-it init                     현재 폴더에 handle-it.config.json 생성
    handle-it status [팀ID]            진행 중인 팀 상태 확인
    handle-it resume [팀ID]            중단된 팀 복구 재실행
    handle-it rerun <태스크ID> [팀ID]  특정 태스크만 재실행
    handle-it logs [팀ID] [필터]       에이전트 로그 조회
    handle-it watch [팀ID]             실시간 모니터링 TUI
    handle-it dashboard [팀ID] [포트]  웹 대시보드 (기본 포트: 3847)
    handle-it --version                버전 확인

  \x1b[1m예시:\x1b[0m
    handle-it "AI 일기 앱, 감정 분석, 다크모드"
    handle-it "가계부 앱" ~/projects/my-budget
    handle-it init && handle-it "내 앱 아이디어"

  \x1b[1m프로젝트 설정 (handle-it.config.json):\x1b[0m
    handle-it init 으로 현재 폴더에 생성 후 수정
  `);
  process.exit(0);
}

// ─────────────────────────────────────
//  autodev init
// ─────────────────────────────────────
if (command === 'init') {
  const configPath = resolve(process.cwd(), 'handle-it.config.json');
  if (existsSync(configPath)) {
    console.log(`\x1b[33m⚠\x1b[0m  handle-it.config.json 이미 존재: ${configPath}`);
    process.exit(0);
  }

  const defaultConfig = {
    version: "1.0",
    agents: ["planner", "architect", "designer", "dev1", "dev2", "qa", "git"],
    timeout: 7200,
    claude_bin: "claude",
    project_dir: null,
    prompts_dir: null,
    _comment: "prompts_dir: 커스텀 프롬프트 경로 (null=패키지 기본값)"
  };

  writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
  console.log(`\x1b[32m✓\x1b[0m  handle-it.config.json 생성됨`);
  console.log(`    수정 후 handle-it "<아이디어>" 실행하세요.`);
  process.exit(0);
}

// ─────────────────────────────────────
//  autodev status
// ─────────────────────────────────────
if (command === 'status') {
  const teamsRoot = process.env.HANDLE_IT_TEAMS_ROOT
    || process.env.AUTODEV_TEAMS_ROOT
    || join(process.env.HOME, '.handle-it', 'teams');

  if (!existsSync(teamsRoot)) {
    console.log('실행 중인 팀 없음');
    process.exit(0);
  }

  const { readdirSync, statSync } = await import('fs');
  const teams = readdirSync(teamsRoot)
    .filter(d => existsSync(join(teamsRoot, d, 'config.json')))
    .sort((a, b) => {
      const ta = statSync(join(teamsRoot, a)).mtimeMs;
      const tb = statSync(join(teamsRoot, b)).mtimeMs;
      return tb - ta;
    });

  if (teams.length === 0) {
    console.log('실행 중인 팀 없음');
    process.exit(0);
  }

  const targetTeam = args[1] || teams[0];
  const configFile = join(teamsRoot, targetTeam, 'config.json');
  const queueFile  = join(teamsRoot, targetTeam, 'tasks', 'queue.json');

  if (!existsSync(configFile)) {
    console.error(`팀을 찾을 수 없음: ${targetTeam}`);
    process.exit(1);
  }

  const config = JSON.parse(readFileSync(configFile, 'utf-8'));
  const queue  = existsSync(queueFile)
    ? JSON.parse(readFileSync(queueFile, 'utf-8'))
    : { tasks: [] };

  const total     = queue.tasks.length;
  const completed = queue.tasks.filter(t => t.status === 'completed').length;
  const failed    = queue.tasks.filter(t => t.status === 'failed').length;
  const running   = queue.tasks.filter(t => t.status === 'in_progress').length;

  console.log(`\n팀: \x1b[1m${config.team_name}\x1b[0m  [${config.status}]`);
  console.log(`태스크: ${completed}/${total} 완료  진행중: ${running}  실패: ${failed}`);
  console.log('');

  queue.tasks.forEach(t => {
    const icon = { completed: '\x1b[32m✓\x1b[0m', in_progress: '\x1b[36m→\x1b[0m', failed: '\x1b[31m✗\x1b[0m', pending: '\x1b[2m○\x1b[0m' }[t.status] || '○';
    const owner = t.owner ? ` (${t.owner})` : '';
    console.log(`  ${icon} [${t.id}] ${t.subject}${owner}`);
  });
  console.log('');

  process.exit(0);
}

// ── 프로젝트 루트 config 읽기 (resume / 메인 실행 공통) ──
let config = {};
{
  const configPath = resolve(process.cwd(), 'handle-it.config.json');
  const legacyConfigPath = resolve(process.cwd(), 'autodev.config.json');
  const activeConfigPath = existsSync(configPath) ? configPath : (existsSync(legacyConfigPath) ? legacyConfigPath : null);
  if (activeConfigPath) {
    try {
      config = JSON.parse(readFileSync(activeConfigPath, 'utf-8'));
      console.log(`\x1b[2m  ${activeConfigPath.split('/').pop()} 로드됨\x1b[0m`);
    } catch (e) {
      console.warn(`\x1b[33m⚠\x1b[0m  config 파싱 실패, 기본값 사용`);
    }
  }
}

// ── config 스키마 검증 ──
{
  const VALID_AGENTS = ['planner', 'architect', 'designer', 'dev1', 'dev2', 'qa', 'git'];
  const errors = [];

  if (config.timeout !== undefined) {
    if (typeof config.timeout !== 'number' || config.timeout <= 0) {
      errors.push(`timeout은 양수여야 합니다 (현재: ${config.timeout})`);
    }
  }
  if (config.task_timeout !== undefined) {
    if (typeof config.task_timeout !== 'number' || config.task_timeout <= 0) {
      errors.push(`task_timeout은 양수여야 합니다 (현재: ${config.task_timeout})`);
    }
  }
  if (config.health_interval !== undefined) {
    if (typeof config.health_interval !== 'number' || config.health_interval <= 0) {
      errors.push(`health_interval은 양수여야 합니다 (현재: ${config.health_interval})`);
    }
  }
  if (config.agents !== undefined) {
    if (!Array.isArray(config.agents)) {
      errors.push('agents는 배열이어야 합니다');
    } else {
      const invalid = config.agents.filter(a => !VALID_AGENTS.includes(a));
      if (invalid.length > 0) {
        errors.push(`알 수 없는 에이전트: ${invalid.join(', ')} (가능: ${VALID_AGENTS.join(', ')})`);
      }
    }
  }
  if (config.project_dir !== undefined && config.project_dir !== null) {
    if (typeof config.project_dir !== 'string') {
      errors.push('project_dir는 문자열이어야 합니다');
    } else if (config.project_dir.includes('..')) {
      errors.push('project_dir에 ".."는 사용할 수 없습니다');
    }
  }
  if (config.prompts_dir !== undefined && config.prompts_dir !== null) {
    if (typeof config.prompts_dir !== 'string') {
      errors.push('prompts_dir는 문자열이어야 합니다');
    }
  }

  if (errors.length > 0) {
    console.error(`\x1b[31m✗\x1b[0m  config 검증 실패:`);
    errors.forEach(e => console.error(`    - ${e}`));
    process.exit(1);
  }
}

// ─────────────────────────────────────
//  handle-it resume [팀ID]
// ─────────────────────────────────────
if (command === 'resume') {
  const teamsRoot = process.env.HANDLE_IT_TEAMS_ROOT
    || process.env.AUTODEV_TEAMS_ROOT
    || join(process.env.HOME, '.handle-it', 'teams');

  if (!existsSync(teamsRoot)) {
    console.log('복구할 팀 없음');
    process.exit(1);
  }

  const { readdirSync, statSync } = await import('fs');
  const teams = readdirSync(teamsRoot)
    .filter(d => existsSync(join(teamsRoot, d, 'config.json')))
    .sort((a, b) => {
      const ta = statSync(join(teamsRoot, a)).mtimeMs;
      const tb = statSync(join(teamsRoot, b)).mtimeMs;
      return tb - ta;
    });

  const targetTeam = args[1] || teams[0];
  if (!targetTeam || !existsSync(join(teamsRoot, targetTeam, 'config.json'))) {
    console.error('복구할 팀을 찾을 수 없음');
    process.exit(1);
  }

  console.log(`\x1b[33m→\x1b[0m  팀 복구: ${targetTeam}`);

  const env = {
    ...process.env,
    AUTODEV_ROOT: SCRIPTS_DIR,
    AUTODEV_PROMPTS: config.prompts_dir
      ? resolve(process.cwd(), config.prompts_dir)
      : PROMPTS_DIR,
    AUTODEV_TEAMS_ROOT: teamsRoot,
    AUTODEV_TIMEOUT: String(config.timeout || 7200),
    AUTODEV_HEALTH_INTERVAL: String(config.health_interval || 5),
    AUTODEV_TASK_TIMEOUT: String(config.task_timeout || 300),
    CLAUDE_BIN: config.claude_bin || process.env.CLAUDE_BIN || 'claude',
    HANDLE_IT_RESUME_TEAM: targetTeam,
  };

  const child = spawn('bash', [join(SCRIPTS_DIR, 'autodev.sh'), '__resume__'], {
    env,
    stdio: 'inherit',
    cwd: process.cwd(),
  });

  await new Promise((_, reject) => {
    child.on('error', err => {
      console.error(`\x1b[31m✗\x1b[0m  실행 실패: ${err.message}`);
      process.exit(1);
    });
    child.on('exit', code => process.exit(code ?? 0));
  });
}

// ─────────────────────────────────────
//  handle-it watch [팀ID]
// ─────────────────────────────────────
if (command === 'watch') {
  const teamsRoot = process.env.HANDLE_IT_TEAMS_ROOT
    || process.env.AUTODEV_TEAMS_ROOT
    || join(process.env.HOME, '.handle-it', 'teams');

  if (!existsSync(teamsRoot)) {
    console.log('실행 중인 팀 없음');
    process.exit(0);
  }

  const { readdirSync, statSync } = await import('fs');
  const teams = readdirSync(teamsRoot)
    .filter(d => existsSync(join(teamsRoot, d, 'config.json')))
    .sort((a, b) => statSync(join(teamsRoot, b)).mtimeMs - statSync(join(teamsRoot, a)).mtimeMs);

  const targetTeam = args[1] || teams[0];
  if (!targetTeam || !existsSync(join(teamsRoot, targetTeam, 'config.json'))) {
    console.error('모니터링할 팀을 찾을 수 없음');
    process.exit(1);
  }

  const watchSh = join(SCRIPTS_DIR, 'watch.sh');
  const child = spawn('bash', [watchSh, join(teamsRoot, targetTeam)], {
    stdio: 'inherit',
    cwd: process.cwd(),
  });

  child.on('exit', code => process.exit(code ?? 0));
  await new Promise(() => {}); // block until child exits
}

// ─────────────────────────────────────
//  handle-it dashboard [팀ID] [포트]
// ─────────────────────────────────────
if (command === 'dashboard') {
  const teamsRoot = process.env.HANDLE_IT_TEAMS_ROOT
    || process.env.AUTODEV_TEAMS_ROOT
    || join(process.env.HOME, '.handle-it', 'teams');

  if (!existsSync(teamsRoot)) {
    console.log('실행 중인 팀 없음');
    process.exit(0);
  }

  const { readdirSync, statSync } = await import('fs');
  const teams = readdirSync(teamsRoot)
    .filter(d => existsSync(join(teamsRoot, d, 'config.json')))
    .sort((a, b) => statSync(join(teamsRoot, b)).mtimeMs - statSync(join(teamsRoot, a)).mtimeMs);

  const targetTeam = args[1] || teams[0];
  if (!targetTeam || !existsSync(join(teamsRoot, targetTeam, 'config.json'))) {
    console.error('모니터링할 팀을 찾을 수 없음');
    process.exit(1);
  }

  const port = args[2] || '3847';
  const dashboardSh = join(SCRIPTS_DIR, 'dashboard.sh');
  const child = spawn('bash', [dashboardSh, join(teamsRoot, targetTeam), port], {
    stdio: 'inherit',
    cwd: process.cwd(),
  });

  child.on('exit', code => process.exit(code ?? 0));
  await new Promise(() => {});
}

// ─────────────────────────────────────
//  handle-it rerun <태스크ID> [팀ID]
// ─────────────────────────────────────
if (command === 'rerun') {
  const taskId = args[1];
  if (!taskId) {
    console.error('\x1b[31m✗\x1b[0m  사용법: handle-it rerun <task_id> [팀ID]');
    process.exit(1);
  }

  const teamsRoot = process.env.HANDLE_IT_TEAMS_ROOT
    || process.env.AUTODEV_TEAMS_ROOT
    || join(process.env.HOME, '.handle-it', 'teams');

  if (!existsSync(teamsRoot)) {
    console.log('실행 중인 팀 없음');
    process.exit(1);
  }

  const { readdirSync, statSync } = await import('fs');
  const teams = readdirSync(teamsRoot)
    .filter(d => existsSync(join(teamsRoot, d, 'config.json')))
    .sort((a, b) => statSync(join(teamsRoot, b)).mtimeMs - statSync(join(teamsRoot, a)).mtimeMs);

  const targetTeam = args[2] || teams[0];
  if (!targetTeam || !existsSync(join(teamsRoot, targetTeam, 'config.json'))) {
    console.error('팀을 찾을 수 없음');
    process.exit(1);
  }

  // Validate task exists in queue
  const queuePath = join(teamsRoot, targetTeam, 'tasks', 'queue.json');
  if (existsSync(queuePath)) {
    const queue = JSON.parse(readFileSync(queuePath, 'utf-8'));
    const task = queue.tasks.find(t => t.id === taskId);
    if (!task) {
      console.error(`\x1b[31m✗\x1b[0m  태스크를 찾을 수 없음: ${taskId}`);
      console.log('  사용 가능한 태스크:');
      queue.tasks.forEach(t => {
        const icon = { completed: '\x1b[32m✓\x1b[0m', failed: '\x1b[31m✗\x1b[0m', pending: '○', in_progress: '\x1b[36m→\x1b[0m' }[t.status] || '○';
        console.log(`    ${icon} ${t.id}  ${t.subject}  [${t.status}]`);
      });
      process.exit(1);
    }
  }

  console.log(`\x1b[33m→\x1b[0m  태스크 재실행: ${taskId} (팀: ${targetTeam})`);

  const env = {
    ...process.env,
    AUTODEV_ROOT: SCRIPTS_DIR,
    AUTODEV_PROMPTS: config.prompts_dir
      ? resolve(process.cwd(), config.prompts_dir)
      : PROMPTS_DIR,
    AUTODEV_TEAMS_ROOT: teamsRoot,
    AUTODEV_TIMEOUT: String(config.timeout || 7200),
    AUTODEV_TASK_TIMEOUT: String(config.task_timeout || 300),
    CLAUDE_BIN: config.claude_bin || process.env.CLAUDE_BIN || 'claude',
    HANDLE_IT_RERUN_TEAM: targetTeam,
    HANDLE_IT_RERUN_TASK: taskId,
  };

  const child = spawn('bash', [join(SCRIPTS_DIR, 'autodev.sh'), '__rerun__'], {
    env,
    stdio: 'inherit',
    cwd: process.cwd(),
  });

  await new Promise((_, reject) => {
    child.on('error', err => {
      console.error(`\x1b[31m✗\x1b[0m  실행 실패: ${err.message}`);
      process.exit(1);
    });
    child.on('exit', code => process.exit(code ?? 0));
  });
}

// ─────────────────────────────────────
//  handle-it logs [팀ID] [필터]
// ─────────────────────────────────────
if (command === 'logs') {
  const teamsRoot = process.env.HANDLE_IT_TEAMS_ROOT
    || process.env.AUTODEV_TEAMS_ROOT
    || join(process.env.HOME, '.handle-it', 'teams');

  if (!existsSync(teamsRoot)) {
    console.log('실행 중인 팀 없음');
    process.exit(0);
  }

  const { readdirSync, statSync } = await import('fs');
  const teams = readdirSync(teamsRoot)
    .filter(d => existsSync(join(teamsRoot, d, 'config.json')))
    .sort((a, b) => statSync(join(teamsRoot, b)).mtimeMs - statSync(join(teamsRoot, a)).mtimeMs);

  const targetTeam = args[1] || teams[0];
  if (!targetTeam || !existsSync(join(teamsRoot, targetTeam))) {
    console.error('팀을 찾을 수 없음');
    process.exit(1);
  }

  const logsDir = join(teamsRoot, targetTeam, 'logs');
  if (!existsSync(logsDir)) {
    console.log('로그 없음');
    process.exit(0);
  }

  const filter = args[2] || '';
  const logFiles = readdirSync(logsDir).filter(f => f.endsWith('.log'));
  console.log(`\n\x1b[1m팀: ${targetTeam}\x1b[0m  로그 ${logFiles.length}개\n`);

  for (const logFile of logFiles) {
    const agentName = logFile.replace('.log', '');
    const content = readFileSync(join(logsDir, logFile), 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());

    const filtered = filter
      ? lines.filter(l => l.toLowerCase().includes(filter.toLowerCase()))
      : lines.slice(-10);

    if (filtered.length > 0) {
      console.log(`\x1b[35m── ${agentName} ──\x1b[0m`);
      filtered.forEach(l => console.log(`  ${l}`));
      console.log('');
    }
  }
  process.exit(0);
}

// ─────────────────────────────────────
//  autodev "<아이디어>" [경로]  — 메인 실행
// ─────────────────────────────────────
const idea       = command;
const projectArg = args[1] || '';

// 환경변수 구성
const env = {
  ...process.env,
  AUTODEV_ROOT:      SCRIPTS_DIR,
  AUTODEV_PROMPTS:   config.prompts_dir
    ? resolve(process.cwd(), config.prompts_dir)
    : PROMPTS_DIR,
  AUTODEV_TEAMS_ROOT: process.env.HANDLE_IT_TEAMS_ROOT
    || process.env.AUTODEV_TEAMS_ROOT
    || join(process.env.HOME, '.handle-it', 'teams'),
  CLAUDE_BIN:        config.claude_bin  || process.env.CLAUDE_BIN  || 'claude',
  AUTODEV_TIMEOUT:   String(config.timeout || 7200),
  AUTODEV_HEALTH_INTERVAL: String(config.health_interval || 5),
  AUTODEV_TASK_TIMEOUT:    String(config.task_timeout || 300),
  AUTODEV_AGENTS:    (config.agents || []).join(','),
};

const autodevSh = join(SCRIPTS_DIR, 'autodev.sh');
if (!existsSync(autodevSh)) {
  console.error(`\x1b[31m✗\x1b[0m  autodev.sh 없음: ${autodevSh}`);
  process.exit(1);
}

const projectDir = projectArg
  || (config.project_dir ? resolve(process.cwd(), config.project_dir) : '');

const child = spawn('bash', [autodevSh, idea, projectDir].filter(Boolean), {
  env,
  stdio: 'inherit',
  cwd: process.cwd(),
});

child.on('error', err => {
  console.error(`\x1b[31m✗\x1b[0m  실행 실패: ${err.message}`);
  process.exit(1);
});

child.on('exit', code => process.exit(code ?? 0));
