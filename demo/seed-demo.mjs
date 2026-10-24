#!/usr/bin/env node
/**
 * CodeMentor Demo 种子脚本：
 * 把 demo/ 下的两个示例工程注册进正在运行的核心服务，
 * 创建任务、设计决策（编码前声明的真实记录）与代码锚点。
 *
 * 前置条件：
 *   1. 已构建并启动核心服务：pnpm build && pnpm --filter @codementor/server start
 *   2. 服务发现文件 <CODEMENTOR_HOME>/server.json 存在（默认 ~/.codementor）
 *
 * 用法：node demo/seed-demo.mjs [--home <服务数据目录>]
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const demoRoot = path.dirname(fileURLToPath(import.meta.url));

function parseHome() {
  const flagIndex = process.argv.indexOf('--home');
  if (flagIndex >= 0 && process.argv[flagIndex + 1]) {
    return path.resolve(process.argv[flagIndex + 1]);
  }
  const envHome = process.env['CODEMENTOR_HOME']?.trim();
  return envHome && envHome.length > 0
    ? path.resolve(envHome)
    : path.join(os.homedir(), '.codementor');
}

function loadState(home) {
  const file = path.join(home, 'server.json');
  if (!fs.existsSync(file)) {
    console.error(`✗ 未找到服务发现文件：${file}`);
    console.error('  请先构建并启动核心服务：');
    console.error('    pnpm install && pnpm build && pnpm --filter @codementor/server start');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function git(cwd, args) {
  return execFileSync(
    'git',
    [
      '-c',
      'user.name=CodeMentor Demo',
      '-c',
      'user.email=demo@codementor.local',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    { cwd, encoding: 'utf8' },
  );
}

function ensureRepo(dir) {
  if (!fs.existsSync(path.join(dir, '.git'))) {
    git(dir, ['init', '-b', 'main']);
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-m', 'demo baseline']);
  }
  return git(dir, ['rev-parse', 'HEAD']).trim();
}

async function api(state, method, p, body) {
  const res = await fetch(`http://127.0.0.1:${state.port}${p}`, {
    method,
    headers: {
      authorization: `Bearer ${state.token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  if (res.status >= 400) {
    throw new Error(`${method} ${p} -> ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

async function seedProject(state, dir, name) {
  const head = ensureRepo(dir);
  const project = await api(state, 'POST', '/api/projects', { name, rootPath: dir });
  console.log(`✓ 项目已注册：${name}（${dir}）`);
  return { project, head };
}

async function seedDemoA(state) {
  const dir = path.join(demoRoot, 'demo-a-simple-c');
  const { project } = await seedProject(state, dir, 'demo-a-simple-c');
  const task = await api(state, 'POST', '/api/tasks', {
    projectId: project.id,
    title: '实现应用配置模块',
    goal: '配置支持环境变量覆盖，坏配置尽早暴露',
  });
  const { decision } = await api(state, 'POST', '/api/decisions', {
    taskId: task.id,
    question: '坏配置应在何时暴露？',
    title: '启动时全量校验配置',
    chosenOption: '启动时 fail-fast 校验（validate_config）',
    alternatives: [{ name: '惰性校验', summary: '首次读取时才校验，启动更快但故障延后' }],
    decidedBy: 'agent',
    declaredClaims: [{ kind: 'constraint', statement: '坏配置必须让调用方在启动阶段失败' }],
  });
  await api(state, 'POST', `/api/decisions/${decision.id}/anchors`, {
    filePath: 'app_config.c',
    symbolPath: ['validate_config'],
    origin: 'declared',
  });
  console.log('✓ Demo A 数据就绪：1 任务 · 1 决策 · 1 锚点');
}

async function seedDemoB(state) {
  const dir = path.join(demoRoot, 'demo-b-riscv-os');
  const { project } = await seedProject(state, dir, 'demo-b-riscv-os');
  const task = await api(state, 'POST', '/api/tasks', {
    projectId: project.id,
    title: '实现上下文切换',
    goal: '在任务切换时保存与恢复执行现场',
  });
  const { decision } = await api(state, 'POST', '/api/decisions', {
    taskId: task.id,
    question: '为什么需要上下文切换，切换时为何只保存部分寄存器？',
    title: '上下文切换采用 callee-saved 策略',
    chosenOption: '仅保存 callee-saved 寄存器（ra/sp/s0-s11）',
    alternatives: [
      { name: '全量寄存器保存', summary: '保存全部 32 个通用寄存器，实现简单但切换开销大' },
    ],
    decidedBy: 'agent',
    declaredClaims: [
      {
        kind: 'tradeoff',
        statement:
          'RISC-V 调用约定下 caller-saved 寄存器由编译器在调用点保存，内核只需保存 callee-saved 寄存器',
      },
    ],
  });
  for (const [filePath, symbol] of [
    ['swtch.c', 'swtch'],
    ['proc.c', 'scheduler'],
  ]) {
    await api(state, 'POST', `/api/decisions/${decision.id}/anchors`, {
      filePath,
      symbolPath: [symbol],
      origin: 'declared',
    });
  }
  console.log('✓ Demo B 数据就绪：1 任务 · 1 决策 · 2 锚点（PCB/状态/调度器/上下文切换）');
}

const home = parseHome();
const state = loadState(home);
console.log(`✓ 已连接核心服务：http://127.0.0.1:${state.port}`);

try {
  await seedDemoA(state);
  await seedDemoB(state);
} catch (err) {
  console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
}

console.log('');
console.log('下一步：');
console.log('  1. 安装扩展：code --install-extension apps/vscode/dist/codementor-0.1.0.vsix');
console.log('  2. 用 VS Code 打开 demo/demo-b-riscv-os（设置 codementor.homeDir 或使用默认目录）');
console.log('  3. 侧栏 CodeMentor → 选择任务「实现上下文切换」→ 查看决策 → 开始学习');
