#!/usr/bin/env node
/** CodeMentor 一键启动：检查环境 → 自动补装/构建 → 启动核心服务。 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, '..');

console.log('============================================');
console.log('  CodeMentor 本地核心服务');
console.log('  数据只存本机，不联网、不上传');
console.log('============================================');
console.log('');

function run(cmd, args, label) {
  console.log(`[CodeMentor] ${label}...`);
  const r = spawnSync(cmd, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) {
    console.error(`[错误] ${label}失败。${r.stderr ?? ''}`);
    process.exit(1);
  }
}

if (spawnSync('pnpm', ['-v'], { shell: process.platform === 'win32' }).status !== 0) {
  console.error('[错误] 未找到 pnpm。请先安装：npm i -g pnpm@8');
  process.exit(1);
}

if (!existsSync(path.join(repoRoot, 'node_modules'))) {
  run('pnpm', ['install'], '首次运行：安装依赖（约 1-2 分钟）');
}
if (!existsSync(path.join(repoRoot, 'apps', 'server', 'dist', 'index.js'))) {
  run('pnpm', ['build'], '首次运行：构建项目（约 30 秒）');
}

console.log('[CodeMentor] 启动服务...');
console.log('  * 本服务只监听 127.0.0.1（仅本机可访问，隐私边界）');
console.log('  * 关闭本窗口或按 Ctrl+C 即停止；数据保留，重启自动恢复');
console.log('  * 服务运行期间，在 VS Code 中打开已注册的项目即可查看决策');
console.log('');

const child = spawn('pnpm', ['--filter', '@codementor/server', 'start'], {
  cwd: repoRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
child.on('exit', (code) => {
  console.log(`[CodeMentor] 服务已停止（退出码 ${code ?? 'N/A'}）。`);
  process.exitCode = code ?? 0;
});
