#!/usr/bin/env node
/**
 * CodeMentor 决策登记工具：对任意仓库一条命令登记 任务/决策/锚点。
 *
 * 交互式（无参数时逐项提问）：
 *   node tools/record-decision.mjs
 * 脚本化（全部用 flags，适合 CI/Agent）：
 *   node tools/record-decision.mjs --repo D:\myproject --task "实现X" \
 *     --question "为什么这样设计？" --title "方案X" --chosen "方案X" \
 *     --claim "constraint|真实理由" --alternative "方案Y|被否决原因" \
 *     --anchor "src/main.c|main"
 *
 * 前置：核心服务已启动（读取 <CODEMENTOR_HOME>/server.json，默认 ~/.codementor）。
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const name = key.slice(2);
    if (name === 'claim' || name === 'alternative' || name === 'anchor') {
      (args[name] ??= []).push(argv[++i]);
    } else {
      args[name] = argv[++i];
    }
  }
  return args;
}

function resolveHome(args) {
  const home = args.home ?? process.env['CODEMENTOR_HOME'];
  return home && home.trim().length > 0
    ? path.resolve(home.trim())
    : path.join(os.homedir(), '.codementor');
}

function loadState(home) {
  const file = path.join(home, 'server.json');
  if (!fs.existsSync(file)) {
    console.error(`✗ 未找到服务发现文件：${file}`);
    console.error('  请先启动核心服务：pnpm --filter @codementor/server start');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function api(state, method, p, body) {
  const res = fetch(`http://127.0.0.1:${state.port}${p}`, {
    method,
    headers: {
      authorization: `Bearer ${state.token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then((r) => r.json().then((json) => ({ status: r.status, json })));
  return res.then(({ status, json }) => {
    if (status >= 400) {
      const msg = json?.error?.message ?? JSON.stringify(json);
      throw new Error(`${method} ${p} -> ${status}: ${msg}`);
    }
    return json;
  });
}

function git(cwd, args) {
  return execFileSync('git', ['-c', 'user.name=CodeMentor', '-c', 'user.email=cm@local', ...args], {
    cwd,
    encoding: 'utf8',
  });
}

function repoRootOf(dir) {
  try {
    return path.resolve(git(dir, ['rev-parse', '--show-toplevel']).trim());
  } catch {
    console.error(`✗ ${dir} 不是 git 仓库（决策需要锚定到真实仓库）`);
    process.exit(1);
  }
}

async function ask(rl, label, fallback) {
  const hint = fallback !== undefined && fallback.length > 0 ? `（回车 = ${fallback}）` : '';
  const answer = (await rl.question(`${label}${hint}: `)).trim();
  return answer.length > 0 ? answer : fallback;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const state = loadState(resolveHome(args));
  console.log(`✓ 已连接核心服务：http://127.0.0.1:${state.port}`);

  // 1. 仓库（--repo 或当前目录）
  const workDir = path.resolve(args.repo ?? process.cwd());
  const rootPath = repoRootOf(workDir);
  const project = await api(state, 'POST', '/api/projects', {
    name: path.basename(rootPath),
    rootPath,
  });
  console.log(`✓ 项目：${project.name}`);

  // 2. 任务：标题匹配进行中任务则复用，否则新建
  let task;
  const tasks = await api(state, 'GET', `/api/projects/${project.id}/tasks`);
  const active = (tasks ?? []).filter((t) => t.status === 'active');
  task = args.task ? active.find((t) => t.title === args.task) : active[active.length - 1];
  if (task !== undefined) {
    console.log(`✓ 复用进行中的任务：${task.title}`);
  } else {
    let title = args.task;
    if (!title) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      title = await ask(rl, '任务标题（正在做什么）');
      rl.close();
      if (!title) {
        console.error('✗ 任务标题不能为空');
        process.exit(1);
      }
    }
    task = await api(state, 'POST', '/api/tasks', {
      projectId: project.id,
      title,
      goal: args.goal ?? '',
    });
    console.log(`✓ 任务已创建：${task.title}`);
  }

  // 3. 决策内容：flags 或交互式问答
  let question = args.question;
  let title2 = args.title;
  let chosen = args.chosen;
  const alternatives = (args.alternative ?? []).map((s) => {
    const [name, ...rest] = s.split('|');
    return { name: (name ?? '').trim(), summary: rest.join('|').trim() };
  });
  const claims = (args.claim ?? []).map((s) => {
    const [kind, ...rest] = s.split('|');
    return { kind: (kind ?? 'tradeoff').trim(), statement: rest.join('|').trim() };
  });

  if (!question || !title2 || !chosen || claims.length === 0) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    question ??= await ask(rl, '设计问题（要决策什么）');
    title2 ??= await ask(rl, '决策标题');
    chosen ??= await ask(rl, '选择了哪个方案');
    if (alternatives.length === 0) {
      console.log('备选方案（可选，直接回车跳过）：');
      for (;;) {
        const raw = await ask(rl, '  备选（名称|否决原因）');
        if (!raw) break;
        const [name, ...rest] = raw.split('|');
        alternatives.push({ name: name.trim(), summary: rest.join('|').trim() });
      }
    }
    while (claims.length === 0) {
      const raw = await ask(rl, '理由（至少一条，kind: constraint/tradeoff/risk/benefit | 内容）');
      if (!raw) continue;
      const [kind, ...rest] = raw.split('|');
      claims.push({ kind: (kind || 'tradeoff').trim(), statement: rest.join('|').trim() });
    }
    rl.close();
  }

  const { decision, claims: storedClaims } = await api(state, 'POST', '/api/decisions', {
    taskId: task.id,
    question,
    title: title2,
    chosenOption: chosen,
    alternatives,
    decidedBy: 'agent',
    declaredClaims: claims,
  });
  console.log(`✓ 决策已声明（declaredAt=${decision.declaredAt}，${storedClaims.length} 条主张）`);

  // 4. 锚点（可选）：--anchor "filePath|symbol"
  for (const raw of args.anchor ?? []) {
    const [filePath, symbol] = raw.split('|').map((s) => s.trim());
    try {
      const anchor = await api(state, 'POST', `/api/decisions/${decision.id}/anchors`, {
        filePath,
        symbolPath: [symbol],
        origin: 'declared',
      });
      console.log(
        `✓ 锚点：${anchor.filePath}:${anchor.startLine}（${anchor.symbolKind} ${anchor.symbolPath.join('.')}）`,
      );
    } catch (err) {
      console.warn(`⚠ 锚点跳过（${filePath}|${symbol}）：${err.message}`);
    }
  }

  console.log('');
  console.log('完成。打开 VS Code（工作区 = 该仓库根目录）即可在 CodeMentor 侧栏看到这条决策。');
}

main().catch((err) => {
  console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
