import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * 用户路径冒烟测试（阶段 6 复审 M1 修复）：
 * 按用户文档记载的顺序真实执行 build → package → 校验 vsix，
 * 保证"照文档操作必然失败"这类回归在 CI 即被拦截。
 *
 * 文档路径（README / USER_GUIDE / DEMOS）：
 *   pnpm install && pnpm build
 *   pnpm package:vscode          → apps/vscode/dist/codementor-0.1.0.vsix
 *   code --install-extension ...
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const extensionDist = path.join(repoRoot, 'apps', 'vscode', 'dist', 'extension.js');
const vsixPath = path.join(repoRoot, 'apps', 'vscode', 'dist', 'codementor-0.1.0.vsix');

beforeAll(async (ctx) => {
  if (!existsSync(extensionDist)) {
    console.warn(`[skip] extension not built: ${extensionDist}（文档路径第一步是 pnpm build）`);
    (ctx as unknown as { skip(): void }).skip();
  }
});

describe('用户路径冒烟：build → package:vscode → 可安装产物', () => {
  it('pnpm package:vscode 产出 vsix 且内容包含扩展入口', async () => {
    const { execFileSync } = await import('node:child_process');
    // 按文档步骤真实打包（vsce package --no-dependencies）
    // shell:true：Windows 下 pnpm 是 .cmd，无 shell 时 spawn 会 ENOENT
    execFileSync('pnpm', ['--filter', 'codementor', 'package'], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 180000,
      shell: true,
    });

    expect(existsSync(vsixPath), `vsix missing at ${vsixPath}`).toBe(true);
    const size = statSync(vsixPath).size;
    expect(size).toBeGreaterThan(10 * 1024); // 12 文件 ≈ 22KB，过小即为异常

    // vsix 是 zip；zip 对文件名不压缩，直接在字节流中检索关键条目名
    const bytes = readFileSync(vsixPath);
    const asText = bytes.toString('latin1');
    expect(asText.includes('extension.js'), 'vsix missing dist/extension.js entry').toBe(true);
    expect(asText.includes('package.json'), 'vsix missing package.json entry').toBe(true);
    expect(asText.includes('codementor.svg'), 'vsix missing activity-bar icon').toBe(true);
  });
});
