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
