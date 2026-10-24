import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runTests } from '@vscode/test-electron';

/**
 * Extension Tests 引导：
 * 1. 准备临时 fixture 工作区（C 工程 + git 仓库 + codementor.homeDir 指向临时服务目录）
 * 2. 启动真实 VS Code（@vscode/test-electron），测试套件内部再拉起真实核心服务
 * 依赖：apps/server/dist 已构建（pnpm build）。
 */
async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, '..', '..');
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const serverEntry = path.join(repoRoot, 'apps', 'server', 'dist', 'index.js');
  if (!fs.existsSync(serverEntry)) {
    throw new Error(`server 构建产物缺失: ${serverEntry}（请先运行 pnpm build）`);
  }

  const serviceHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-vsc-home-'));
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-vsc-ws-'));

  fs.writeFileSync(
    path.join(fixture, 'proc.h'),
    '#ifndef PROC_H\n#define PROC_H\nstruct pcb { int pid; int state; };\n#endif\n',
  );
  fs.writeFileSync(
    path.join(fixture, 'proc.c'),
    '#include "proc.h"\nstatic struct pcb table[8];\nstatic struct pcb *current;\nvoid switch_to(struct pcb *next) { current = next; }\nvoid scheduler(void) { switch_to(&table[0]); }\n',
  );
  fs.mkdirSync(path.join(fixture, '.vscode'));
  fs.writeFileSync(
    path.join(fixture, '.vscode', 'settings.json'),
    JSON.stringify({ 'codementor.homeDir': serviceHome }, null, 2),
  );
  const git = (args: string[]): void => {
    execFileSync(
      'git',
      [
        '-c',
        'user.name=CodeMentor Test',
        '-c',
        'user.email=cm-test@codementor.local',
        '-c',
        'commit.gpgsign=false',
        ...args,
      ],
      { cwd: fixture, encoding: 'utf8' },
    );
  };
  git(['init', '-b', 'main']);
  git(['add', '-A']);
  git(['commit', '-m', 'fixture: proc project']);

  // 套件启动前干跑一次服务，确保服务进程在测试环境可拉起（提前暴露环境问题）
  const probe = spawn(process.execPath, [serverEntry], {
    env: { ...process.env, CODEMENTOR_HOME: path.join(serviceHome, 'probe') },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const probeWait = new Promise<void>((resolve) => {
    const file = path.join(serviceHome, 'probe', 'server.json');
    const timer = setInterval(() => {
      if (fs.existsSync(file)) {
        clearInterval(timer);
        resolve();
      }
    }, 100);
    setTimeout(() => {
      clearInterval(timer);
      resolve();
    }, 10000);
  });
  await probeWait;
  probe.kill();
  await new Promise<void>((resolve) => probe.once('exit', () => resolve()));
  // 尽力清理：Windows 下句柄释放可能滞后，失败不影响测试
  try {
    fs.rmSync(path.join(serviceHome, 'probe'), { recursive: true, force: true });
  } catch {
    // 忽略
  }

  try {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath: path.resolve(__dirname, 'suite', 'index.js'),
      launchArgs: [fixture, '--disable-workspace-trust', '--disable-extensions'],
      extensionTestsEnv: {
        CODEMENTOR_TEST_HOME: serviceHome,
        CODEMENTOR_TEST_WS: fixture,
        CODEMENTOR_TEST_SERVER: serverEntry,
        // 扩展宿主内 process.execPath 是 VS Code 自身，必须显式传真实 node
        CODEMENTOR_TEST_NODE: process.execPath,
      },
    });
  } finally {
    fs.rmSync(serviceHome, { recursive: true, force: true });
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  console.error('[extension tests] failed:', err);
  process.exit(1);
});
